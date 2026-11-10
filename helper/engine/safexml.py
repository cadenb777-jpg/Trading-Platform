"""
Safe XML reading for everything the helper downloads (SEC filings, news feeds, spreadsheet parts).

Python's parser would expand entity declarations, so a booby-trapped document (the "billion laughs" trick) could make
a few kilobytes grow into gigabytes and freeze the helper. Real SEC filings, RSS feeds and .xlsx files never declare
entities or a DOCTYPE, so any document that does is refused here before it is read: the same protection as the
well-known defusedxml package, without another download. A small checking parser (the standard library's expat) sees
every byte first; streamed files are checked chunk by chunk. Use these instead of xml.etree's fromstring/iterparse.
"""
import xml.etree.ElementTree as ET
from xml.parsers import expat

ParseError = ET.ParseError


class UnsafeXML(ValueError):
    """The document declares a DOCTYPE or entities, which real data never does here."""


def _refuse(*_args):
    raise UnsafeXML('This document declares entities or a DOCTYPE, so it was not read (it could be an attack).')


def _checker(encoding=None):
    p = expat.ParserCreate(encoding)  # an encoding given here overrides the document's own declaration
    p.StartDoctypeDeclHandler = _refuse
    p.EntityDeclHandler = _refuse
    p.UnparsedEntityDeclHandler = _refuse
    p.ExternalEntityRefHandler = _refuse
    return p


def check(data):
    """Raises UnsafeXML for a document with a DOCTYPE or entity declarations (checks the whole text).
    Text (str) is read exactly as ElementTree reads it: whatever encoding its first line claims is ignored, so a
    document saying encoding="UTF-16" can't slip past the check while ElementTree parses it anyway."""
    is_text = isinstance(data, str)
    p = _checker('utf-8' if is_text else None)
    try:
        p.Parse(data.encode('utf-8') if is_text else data, True)
    except expat.ExpatError:
        pass  # malformed XML is ElementTree's to report (ParseError), with its usual message


def fromstring(text):
    """Like ElementTree.fromstring, but refuses DOCTYPE/entity declarations (UnsafeXML)."""
    check(text)
    return ET.fromstring(text)


class _Checked:
    """A file wrapper: every chunk ElementTree reads is shown to the checking parser first."""

    def __init__(self, fh):
        self.fh, self.p, self.broken = fh, _checker(), False

    def read(self, size=-1):
        chunk = self.fh.read(size)
        if not self.broken:
            try:
                self.p.Parse(chunk.encode('utf-8') if isinstance(chunk, str) else chunk, not chunk)
            except expat.ExpatError:
                self.broken = True  # malformed: ElementTree reports it
        return chunk


def iterparse(source, events=None):
    """Like ElementTree.iterparse (end events by default) on an open file, with the same refusal; streams large files."""
    return ET.iterparse(_Checked(source), events=events)
