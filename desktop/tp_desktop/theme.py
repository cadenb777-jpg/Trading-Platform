"""Colours and the Qt style sheet: the website's navy theme with Bloomberg text roles (amber labels, white figures,
green/red changes). One place for every colour in the app."""

C = {
    'bg': '#050d19', 'surface': '#0a1a2e', 'raised': '#0f233b', 'line': '#17304b', 'line_strong': '#25476b',
    'text': '#e8f1fa', 'strong': '#ffffff', 'muted': '#adc1d6', 'faint': '#62809e',
    'label': '#f2b23a', 'accent': '#7ac3ee', 'copper': '#e0803f',
    'up': '#4fd3ab', 'down': '#ff958c', 'up_fill': '#2fbf95', 'down_fill': '#f0645a',
    'chart_bg': '#071629', 'grid': '#46648a',
}

QSS = f"""
* {{ font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial; font-size: 13px; color: {C['text']}; }}
QMainWindow, QWidget#root {{ background: {C['bg']}; }}
QMenuBar {{ background: {C['bg']}; border-bottom: 1px solid {C['line']}; }}
QMenuBar::item:selected {{ background: {C['raised']}; }}
QMenu {{ background: {C['surface']}; border: 1px solid {C['line_strong']}; }}
QMenu::item:selected {{ background: {C['raised']}; }}
QLineEdit {{ background: {C['raised']}; border: 1px solid {C['line']}; border-radius: 6px; padding: 5px 8px; }}
QLineEdit:focus {{ border-color: {C['accent']}; }}
QPushButton {{ background: {C['raised']}; border: 1px solid {C['line']}; border-radius: 6px; padding: 5px 12px; }}
QPushButton:hover {{ border-color: {C['accent']}; }}
QPushButton:checked {{ background: {C['line_strong']}; color: {C['strong']}; }}
QTabBar::tab {{ background: transparent; padding: 7px 14px; border: 0; border-bottom: 2px solid transparent; color: {C['muted']}; }}
QTabBar::tab:selected {{ color: {C['strong']}; border-bottom: 2px solid {C['copper']}; }}
QTabBar::tab:hover {{ color: {C['strong']}; }}
QTableWidget {{ background: {C['surface']}; gridline-color: {C['line']}; border: 1px solid {C['line']}; border-radius: 8px; }}
QHeaderView::section {{ background: {C['surface']}; color: {C['label']}; border: 0; border-bottom: 1px solid {C['line_strong']};
  padding: 6px; font-size: 11px; letter-spacing: 1px; }}
QTableWidget::item:selected {{ background: {C['raised']}; }}
QDockWidget {{ color: {C['label']}; }}
QDockWidget::title {{ background: {C['bg']}; padding: 6px; }}
QStatusBar {{ background: {C['bg']}; border-top: 1px solid {C['line']}; }}
QLabel#label {{ color: {C['label']}; font-size: 11px; letter-spacing: 1px; }}
QLabel#figure {{ color: {C['strong']}; font-size: 20px; font-weight: 600; }}
QLabel#section {{ color: {C['label']}; font-weight: 600; letter-spacing: 2px; padding: 0 10px; }}
QFrame#card {{ background: {C['surface']}; border: 1px solid {C['line']}; border-radius: 10px; }}
QFrame#fkeys {{ background: {C['bg']}; border-top: 1px solid {C['line']}; }}
QPushButton#fkey {{ background: transparent; border: 0; padding: 4px 10px; }}
QPushButton#fkey:hover {{ background: {C['raised']}; }}
"""
