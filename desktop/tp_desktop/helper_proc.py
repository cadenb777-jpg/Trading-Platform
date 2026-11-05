"""Starts and stops the desktop's own helper: the repository's helper/schwab_helper.py with --desktop (port 8766).
Its output goes to the app's log panel. Schwab keys and the login token are shared with the website's helper
(~/.trading-platform); first-time setup is done once with the website's helper."""
import sys
from pathlib import Path

from PySide6.QtCore import QObject, QProcess, Signal

HELPER = Path(__file__).resolve().parents[2] / 'helper' / 'schwab_helper.py'


class DesktopHelper(QObject):
    output = Signal(str)

    def __init__(self):
        super().__init__()
        self.proc = QProcess(self)
        self.proc.setProcessChannelMode(QProcess.MergedChannels)
        self.proc.readyReadStandardOutput.connect(lambda: self.output.emit(bytes(self.proc.readAllStandardOutput()).decode(errors='replace')))

    def start(self):
        if not HELPER.exists():
            self.output.emit(f'Helper not found at {HELPER}\n')
            return
        if self.proc.state() != QProcess.NotRunning:
            return
        self.output.emit('Starting the desktop helper...\n')
        self.proc.setWorkingDirectory(str(HELPER.parent))
        self.proc.start(sys.executable, [str(HELPER), '--desktop'])

    def stop(self):
        if self.proc.state() != QProcess.NotRunning:
            self.proc.terminate()
            if not self.proc.waitForFinished(4000):
                self.proc.kill()
