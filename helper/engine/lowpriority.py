"""Background maths (scanner, simulations, portfolio maths, prospect files) runs at low priority, so it uses only time
the computer has spare: the platform window, charts and replies to clicks always come first."""
import os


def lower_priority():
    try:
        if os.name == 'nt':
            import ctypes
            kernel = ctypes.windll.kernel32
            kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
        else:
            os.nice(10)
    except Exception:  # never stop a worker over this
        pass
