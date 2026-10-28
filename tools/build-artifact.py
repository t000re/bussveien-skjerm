"""Samler prototypen i én HTML-fil (CSS, JS og font inline) for publisering som claude.ai-artifact.
Bruk: python3 tools/build-artifact.py  ->  dist/bussveien.html"""
import base64, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')

font = base64.b64encode((root / 'fonts/inter-latin-wght-normal.woff2').read_bytes()).decode()
css = (root / 'css/style.css').read_text(encoding='utf-8')
css = css.replace("url('../fonts/inter-latin-wght-normal.woff2')", f"url(data:font/woff2;base64,{font})")
css = css.replace(':root {', ':root {\n  color-scheme: dark;', 1)

def inline_script(m):
    src = (root / m.group(1).split('?')[0]).read_text(encoding='utf-8')
    return '<script>\n' + src.replace('</script', '<\\/script') + '\n</script>'

body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script src="([^"]+)"></script>', inline_script, body)
title = re.search(r'<title>(.*?)</title>', html).group(1)

out = f'<title>{title}</title>\n<style>\n{css}\n</style>\n{body}'
dist = root / 'dist'
dist.mkdir(exist_ok=True)
(dist / 'bussveien.html').write_text(out, encoding='utf-8')
print('Skrev', dist / 'bussveien.html', f'({len(out) // 1024} KB)')
