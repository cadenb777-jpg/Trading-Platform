"""
YCharts through the owner's YCharts Excel add-in (Windows). YCharts sells its data to the owner as an Excel add-in
(an XLL with the formulas YCP, YCS, YCI, YCH ...), signed in inside Excel, so the helper asks Excel:

  1. It finds the Excel that is already running (where the add-in is loaded and signed in), or starts Excel minimised
     with its own scratch workbook (~/.trading-platform/ycharts-bridge.xlsx), the way a person opening a file would,
     so Excel loads its add-ins.
  2. In that scratch workbook only (its window hidden) it writes the formulas, waits while the cells say "Loading...",
     reads the values, clears the cells and marks the workbook saved (so Excel never asks to save it).
  3. It never touches any other workbook, and it only reads data.

Excel is driven by Windows PowerShell (built into Windows; nothing to install). The request goes in a JSON file in
~/.trading-platform, the answer comes back as JSON on stdout. One request at a time.

Formula syntax, from YCharts' own Excel syntax sheet:
  YCP(ticker, calculation, date, retrieve date, transpose, fill null)        one value
  YCS(ticker, calculation, sdate, edate, reverse, transpose, retrieve date, fill null, resample frequency, ...)
  YCI(ticker, info field, transpose, show headers, fill null)                 one info field (text)
  YCH(ticker, show weights, weight type, transpose, show headers)             fund holdings
Tickers: stocks and ETFs as is, mutual funds M:VFIAX, economic indicators I:USGDP (calculation left blank).

Client privacy (owner's rule, 2026-11-20): YCharts Portfolios hold the owner's client portfolios. The helper never asks
for them: a portfolio ticker (P:...) is refused before Excel is asked, and the account formula YCU (accounts, clients,
holdings, transactions, watchlists) is never built. Only market data: stocks, funds, indexes, economic indicators.
"""
import asyncio
import base64
import datetime as dt
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

from .core import EngineError

HOME = Path.home() / '.trading-platform'
BRIDGE = HOME / 'ycharts-bridge.xlsx'
REQUEST = HOME / 'ycharts-request.json'
NULL = 'TP_NULL'  # YCharts' <fill null>: what a cell shows when YCharts has no value
ID = re.compile(r'^[A-Za-z0-9^:._\-]{1,24}$')
CODE = re.compile(r'^[a-z0-9_]{1,80}$')

ERRORS = {2000: '#NULL!', 2007: '#DIV/0!', 2015: '#VALUE!', 2023: '#REF!', 2029: '#NAME?', 2036: '#NUM!', 2042: '#N/A',
          2043: '#GETTING_DATA', 2045: '#SPILL!', 2046: '#CONNECT!', 2047: '#BLOCKED!', 2048: '#UNKNOWN!', 2049: '#FIELD!',
          2050: '#CALC!'}

MESSAGES = {
    'no-excel': 'Excel could not be started on this computer. The YCharts add-in needs Microsoft Excel (Windows).',
    'excel-start': 'Excel did not finish starting in time. Open Excel yourself once, then try again.',
    'no-bridge': 'The helper could not create its YCharts scratch workbook.',
}
NO_ADDIN = ('Excel does not know the YCharts formulas: open Excel, check the YCharts tab is there and that you are '
            'signed in, then try again.')

_lock = asyncio.Lock()


def available():
    return sys.platform == 'win32'


# ---------- formulas (pure, tested) ----------

def _q(text):
    """A quoted formula argument. Ids and codes are checked against strict patterns first, so no quote can get in."""
    return f'"{text}"'


#: ticker prefixes the helper never sends: P: = YCharts Portfolios (the owner's client portfolios)
PRIVATE_PREFIXES = ('P:',)


def check_id(security_id):
    s = str(security_id or '').strip()
    if s.upper().startswith(PRIVATE_PREFIXES):
        raise EngineError('YCharts portfolios hold client data and are never read by the platform.')
    if not ID.match(s):
        raise EngineError(f'"{s}" is not a YCharts ticker (e.g. AAPL, M:VFIAX, I:USGDP).')
    return s


def check_code(code):
    c = str(code or '').strip().lower()
    if not CODE.match(c):
        raise EngineError(f'"{c}" is not a YCharts metric code (lower case, e.g. pe_ratio).')
    return c


def is_indicator(security_id):
    return security_id.upper().startswith('I:')


def point_formula(security_id, code, date=None):
    """=YCP("AAPL","pe_ratio",,,,"TP_NULL"); economic indicators leave the calculation blank."""
    calc = '' if is_indicator(security_id) else _q(code)
    return f'=YCP({_q(security_id)},{calc},{_q(date) if date else ""},,,{_q(NULL)})'


def dated_point_formula(security_id, code):
    """=YCP("WMT","price",,"Y",,"TP_NULL"): the latest value and the date it is as of (two cells)."""
    calc = '' if is_indicator(security_id) else _q(code)
    return f'=YCP({_q(security_id)},{calc},,"Y",,{_q(NULL)})'


#: YCharts' accepted YCS options (its "YCS Parameter Options" sheet)
FREQUENCIES = ('daily', 'market_daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'market_monthly', 'quarterly',
               'market_quarterly', 'semi_yearly', 'yearly', 'market_yearly')
RESAMPLE = ('last', 'first', 'mean', 'median', 'min', 'max', 'sum', 'std')
AGGREGATES = ('mean', 'median', 'min', 'max', 'first', 'last', 'sum', 'std', 'pct_change')


def _option(value, allowed, what):
    v = str(value or '').strip().lower()
    if not v:
        return None
    if v not in allowed:
        raise EngineError(f'"{v}" is not a YCharts {what} ({", ".join(allowed)}).')
    return v


def series_formula(security_id, code, start, end=None, frequency=None, resample=None):
    """=YCS(ticker, calc, start, end, , , "Y" (dates too), "TP_NULL"[, frequency, function]): two columns, dates then
    values, oldest first. A frequency resamples (e.g. monthly, last value of each month)."""
    calc = '' if is_indicator(security_id) else _q(code)
    f = _option(frequency, FREQUENCIES, 'frequency')
    tail = f',{_q(f)},{_q(_option(resample, RESAMPLE, "resample function") or "last")}' if f else ''
    return f'=YCS({_q(security_id)},{calc},{_q(start)},{_q(end) if end else ""},,,"Y",{_q(NULL)}{tail})'


def calc_formula(security_id, code, start, end, aggregate):
    """=YCS(ticker, calc, start, end, , , "Y", "TP_NULL", , , , "max"): one statistic over the period and its date."""
    calc = '' if is_indicator(security_id) else _q(code)
    agg = _option(aggregate, AGGREGATES, 'calculation')
    if not agg:
        raise EngineError('Pick a calculation (mean, max, % change ...).')
    return f'=YCS({_q(security_id)},{calc},{_q(start)},{_q(end) if end else ""},,,"Y",{_q(NULL)},,,,{_q(agg)})'


def info_formula(security_id, field):
    return f'=YCI({_q(security_id)},{_q(field)},,,{_q(NULL)})'


def holdings_formula(security_id):
    return f'=YCH({_q(security_id)},"Y",,,"Y")'


def guard_formula(formula):
    """Last check before anything reaches Excel: only the market-data formulas, never a portfolio or account (tested)."""
    f = str(formula)
    m = re.match(r'^=(YCP|YCS|YCI|YCH)\("([^"]*)"', f)
    if not m or re.search(r'(?i)\bYCU\s*\(', f):
        raise EngineError('Only YCharts market-data formulas are allowed.')
    check_id(m.group(2))
    return f


# ---------- reading cells (pure, tested) ----------

def _excel_date(v):
    """A date from Excel: 'YYYY-MM-DD' text (YCharts sends text) or an Excel serial number."""
    if isinstance(v, str):
        s = v.strip()[:10]
        return s if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s) else None
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 1 < v < 2958465:
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(v))).isoformat()
    return None


def cell_error(v):
    """Plain words for a cell that is not a value, or None."""
    if isinstance(v, dict) and 'err' in v:
        return ERRORS.get(v['err'], f'Excel error {v["err"]}')
    if v is None or v == '' or v == NULL:
        return 'no data'
    if isinstance(v, str) and (v.upper().startswith('ERR') or v.startswith('#')):
        return v.strip()
    return None


def point_value(cell):
    """{'value', 'date', 'error'} for one YCP cell."""
    v = (cell or {}).get('v')
    if (cell or {}).get('pending'):
        return {'value': None, 'date': None, 'error': 'still loading in Excel'}
    err = cell_error(v)
    if err:
        return {'value': None, 'date': None, 'error': err}
    if isinstance(v, bool):
        return {'value': None, 'date': None, 'error': 'not a value'}
    return {'value': v, 'date': None, 'error': None}


def dated_value(cell):
    """(value, 'YYYY-MM-DD' or None) from a YCP cell asked with <retrieve date>: a date cell and a number cell."""
    flat = [x for row in ((cell or {}).get('spill') or []) if isinstance(row, list) for x in row]
    if not flat:
        flat = [(cell or {}).get('v')]
    date = next((d for d in (_excel_date(x) if isinstance(x, str) else None for x in flat) if d), None)
    value = next((x for x in flat if isinstance(x, (int, float)) and not isinstance(x, bool)), None)
    return value, date


async def dated_points(security_id, codes):
    """{code: (value, date)} for one security, each asked with its as-of date."""
    cells = [{'r': 1 + 2 * k, 'c': 1, 'f': dated_point_formula(security_id, code), 'spill': True} for k, code in enumerate(codes)]
    data = await run(cells, timeout=60)
    got = _by_pos(data['cells'])
    return {code: dated_value(got.get((1 + 2 * k, 1))) for k, code in enumerate(codes)}


def series_points(cell):
    """[[date, value], ...] from a YCS cell that spilled two columns (date, value), oldest first."""
    rows = (cell or {}).get('spill') or []
    out = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 2:
            continue
        d, v = _excel_date(row[0]), row[-1]
        if d and isinstance(v, (int, float)) and not isinstance(v, bool):
            out.append([d, v])
    out.sort(key=lambda p: p[0])
    return out


def holdings_rows(cell):
    """[{'ticker','name','weight'}] from a YCH cell with headers and weights."""
    rows = (cell or {}).get('spill') or []
    if not rows:
        return []
    head = [str(h or '').strip().lower() for h in rows[0]]
    has_head = any(h in ('holdings', 'holding', 'weight', 'weights', 'ticker', 'name') for h in head)
    body = rows[1:] if has_head else rows
    out = []
    for r in body:
        if not isinstance(r, list) or not r or cell_error(r[0]):
            continue
        weight = next((x for x in r[1:] if isinstance(x, (int, float)) and not isinstance(x, bool)), None)
        out.append({'holding': str(r[0]), 'weight': weight})
    return out


def addin_missing(cells):
    """True when every cell says #NAME?: Excel doesn't know the YCharts formulas (add-in not loaded)."""
    errs = [c.get('v') for c in cells]
    return bool(errs) and all(isinstance(v, dict) and v.get('err') == 2029 for v in errs)


# ---------- the scratch workbook ----------

_XLSX = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="YCharts" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
}


def ensure_bridge(path=BRIDGE):
    """Writes the empty scratch workbook once (a minimal .xlsx, standard library only)."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, text in _XLSX.items():
            zf.writestr(name, text)
    os.replace(tmp, path)
    return path


# ---------- the PowerShell side ----------

SCRIPT = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$req = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:TP_YC_REQUEST | ConvertFrom-Json
function Done($o) { [Console]::Out.Write(($o | ConvertTo-Json -Depth 8 -Compress)); exit 0 }
function Busy($e) {
  $x = $e.Exception
  while ($x) { if ($x.HResult -eq -2147418111 -or $x.HResult -eq -2147417846) { return $true }; $x = $x.InnerException }
  return $false
}
# Excel refuses calls while someone is typing in a cell: wait and retry (about 15 seconds)
function Com([scriptblock]$b) {
  for ($i = 0; $i -lt 60; $i++) { try { return (& $b) } catch { if (Busy $_) { Start-Sleep -Milliseconds 250 } else { throw } } }
  throw 'Excel is busy (a cell may be in edit mode). Press Enter or Esc in Excel and try again.'
}
function Get-Excel { try { return [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { return $null } }
function Conv($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [int] -and $v -ge -2146826288 -and $v -le -2146826228) { return @{ err = $v + 2146828288 } }
  return $v
}
$pendingText = '^(?i)\s*(loading|retrieving|requesting|fetching|calculating|#busy|#getting_data)'
function Read-Cell($ws, $c) {
  $cell = $ws.Cells.Item([int]$c.r, [int]$c.c)
  $text = [string]$cell.Text
  $v = Conv $cell.Value2
  $spill = $null
  if ($c.spill) {
    $has = $false
    try { $has = [bool]$cell.HasSpill } catch {}
    if ($has) {
      $rg = $cell.SpillingToRange
      $nr = [Math]::Min([int]$rg.Rows.Count, [int]$req.maxRows)
      $nc = [Math]::Min([int]$rg.Columns.Count, 20)
      $vals = $rg.Value2
      $rows = New-Object System.Collections.ArrayList
      for ($i = 1; $i -le $nr; $i++) {
        $row = New-Object System.Collections.ArrayList
        for ($j = 1; $j -le $nc; $j++) { [void]$row.Add((Conv $vals[$i, $j])) }
        [void]$rows.Add($row)
      }
      $spill = $rows
    } else { $spill = @(,@($v)) }
  }
  $pending = ($text -match $pendingText) -or (($v -is [hashtable]) -and ($v.err -eq 2043))
  return @{ r = $c.r; c = $c.c; v = $v; text = $text; spill = $spill; pending = $pending }
}

$xl = Get-Excel
$launched = $false
if (-not $xl) {
  if (-not (Test-Path -LiteralPath $req.path)) { Done @{ ok = $false; code = 'no-bridge' } }
  # Start Excel the normal way (so it loads the YCharts add-in), minimised, with the scratch workbook
  try { Start-Process -FilePath 'excel.exe' -ArgumentList ('"' + $req.path + '"') -WindowStyle Minimized } catch { Done @{ ok = $false; code = 'no-excel'; message = $_.Exception.Message } }
  $launched = $true
  $until = (Get-Date).AddSeconds(90)
  while (-not $xl -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 800; $xl = Get-Excel }
  if (-not $xl) { Done @{ ok = $false; code = 'excel-start' } }
}
$wb = $null
for ($k = 0; $k -lt 40 -and -not $wb; $k++) {
  try {
    $wb = Com { $f = $null; foreach ($w in $xl.Workbooks) { if ($w.FullName -ieq $req.path) { $f = $w } }; $f }
    if (-not $wb -and -not $launched) { $wb = Com { $xl.Workbooks.Open($req.path) } }
  } catch { $wb = $null }  # Excel still starting: try again
  if (-not $wb) { Start-Sleep -Milliseconds 500 }
}
if (-not $wb) { Done @{ ok = $false; code = 'excel-start' } }
Com { foreach ($win in $wb.Windows) { $win.Visible = $false } } | Out-Null
$ws = Com { $wb.Worksheets.Item(1) }
Com { [void]$ws.Cells.Clear() } | Out-Null
foreach ($c in $req.cells) {
  Com { $cell = $ws.Cells.Item([int]$c.r, [int]$c.c); try { $cell.Formula2 = $c.f } catch { $cell.Formula = $c.f } } | Out-Null
}
Com { $ws.Calculate() } | Out-Null
$deadline = (Get-Date).AddSeconds([double]$req.timeout)
do {
  Start-Sleep -Milliseconds 400
  $busy = $false
  $out = New-Object System.Collections.ArrayList
  foreach ($c in $req.cells) {
    $res = Com { Read-Cell $ws $c }
    if ($res.pending) { $busy = $true }
    [void]$out.Add($res)
  }
} while ($busy -and (Get-Date) -lt $deadline)
Com { [void]$ws.Cells.Clear(); $wb.Saved = $true } | Out-Null
Done @{ ok = $true; launched = $launched; timedOut = $busy; version = [string]$xl.Version; cells = $out }
'''


async def run(cells, timeout=60):
    """Writes `cells` ([{'r','c','f','spill'}]) into the scratch workbook and returns Excel's answer for each."""
    if not available():
        raise EngineError('The YCharts Excel add-in works through Excel on Windows; this helper is not on Windows.')
    for c in cells:
        guard_formula(c['f'])
    async with _lock:
        ensure_bridge()
        REQUEST.write_text(json.dumps({'path': str(BRIDGE), 'cells': cells, 'timeout': timeout, 'maxRows': 6000}), encoding='utf-8')
        encoded = base64.b64encode(SCRIPT.encode('utf-16-le')).decode('ascii')
        env = {**os.environ, 'TP_YC_REQUEST': str(REQUEST)}
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        proc = await asyncio.create_subprocess_exec(
            'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env, creationflags=flags)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout + 150)
        except asyncio.TimeoutError:
            proc.kill()
            raise EngineError('Excel did not answer in time. Is a dialog box open in Excel?') from None
    try:
        data = json.loads(out.decode('utf-8-sig', 'replace') or '{}')
    except ValueError:
        tail = (err.decode('utf-8', 'replace').strip().splitlines() or ['no answer'])[-1][:300]
        raise EngineError(f'The Excel bridge failed: {tail}') from None
    if not data.get('ok'):
        raise EngineError(MESSAGES.get(data.get('code'), data.get('message') or 'The Excel bridge failed.'))
    cells_out = data.get('cells') or []
    if isinstance(cells_out, dict):  # PowerShell sends a single item as an object
        cells_out = [cells_out]
    if addin_missing(cells_out):
        raise EngineError(NO_ADDIN)
    data['cells'] = cells_out
    return data


def _by_pos(cells):
    return {(int(c.get('r', 0)), int(c.get('c', 0))): c for c in cells}


async def points(ids, codes, date=None):
    """{id: {code: {'value','date','error'}}}: one YCP per id x code, laid out as a grid."""
    cells = [{'r': i + 1, 'c': j + 1, 'f': point_formula(sid, code, date)} for i, sid in enumerate(ids) for j, code in enumerate(codes)]
    data = await run(cells, timeout=60 + 2 * len(cells) ** 0.5)
    got = _by_pos(data['cells'])
    return {sid: {code: point_value(got.get((i + 1, j + 1))) for j, code in enumerate(codes)} for i, sid in enumerate(ids)}, data


async def series(ids, codes, start, end=None, frequency=None, resample=None):
    """{id: {code: {'points', 'error'}}}: one YCS per id x code, side by side (three columns apart)."""
    pairs = [(sid, code) for sid in ids for code in codes]
    cells = [{'r': 1, 'c': 1 + 3 * k, 'f': series_formula(sid, code, start, end, frequency, resample), 'spill': True} for k, (sid, code) in enumerate(pairs)]
    data = await run(cells, timeout=90)
    got = _by_pos(data['cells'])
    out = {}
    for k, (sid, code) in enumerate(pairs):
        cell = got.get((1, 1 + 3 * k)) or {}
        pts = series_points(cell)
        first = ((cell.get('spill') or [[None]])[0] or [None])[0]
        out.setdefault(sid, {})[code] = {'points': pts, 'error': None if pts else ('still loading in Excel' if cell.get('pending') else cell_error(first) or cell_error(cell.get('v')) or 'no data')}
    return out, data


async def info(ids, fields):
    cells = [{'r': i + 1, 'c': j + 1, 'f': info_formula(sid, f)} for i, sid in enumerate(ids) for j, f in enumerate(fields)]
    data = await run(cells, timeout=60)
    got = _by_pos(data['cells'])
    return {sid: {f: point_value(got.get((i + 1, j + 1)))['value'] for j, f in enumerate(fields)} for i, sid in enumerate(ids)}, data


async def holdings(security_id):
    data = await run([{'r': 1, 'c': 1, 'f': holdings_formula(security_id), 'spill': True}], timeout=90)
    return holdings_rows(data['cells'][0] if data['cells'] else None), data


async def calc(ids, codes, start, end, aggregate):
    """{id: {code: {'value', 'date', 'error'}}}: one YCharts statistic per id x code over the period."""
    pairs = [(sid, code) for sid in ids for code in codes]
    cells = [{'r': 1 + 2 * k, 'c': 1, 'f': calc_formula(sid, code, start, end, aggregate), 'spill': True} for k, (sid, code) in enumerate(pairs)]
    data = await run(cells, timeout=90)
    got = _by_pos(data['cells'])
    out = {}
    for k, (sid, code) in enumerate(pairs):
        cell = got.get((1 + 2 * k, 1)) or {}
        value, date = dated_value(cell)
        first = ((cell.get('spill') or [[None]])[0] or [None])[0]
        out.setdefault(sid, {})[code] = {'value': value, 'date': date,
                                         'error': None if value is not None else ('still loading in Excel' if cell.get('pending') else cell_error(first) or 'no data')}
    return out
