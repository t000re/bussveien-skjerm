"""Setter nytt versjonsnummer før hver publisering.
Oppdaterer version.json og ?v=-parametrene i index.html, slik at nettlesere henter nye
filer i stedet for gamle kopier, og slik at åpne skjermer laster seg selv på nytt.
Bruk: python3 tools/bump-version.py"""
import json, pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
version = time.strftime('%Y%m%d%H%M%S')
(root / 'version.json').write_text(json.dumps({'version': version}) + '\n', encoding='utf-8')

index = root / 'index.html'
html = index.read_text(encoding='utf-8')
html = re.sub(r'(src|href)="((?:js|css)/[^"?]+)(\?v=[^"]*)?"', lambda m: f'{m.group(1)}="{m.group(2)}?v={version}"', html)
html = re.sub(r"window\.BV_VERSION = '[^']*'", f"window.BV_VERSION = '{version}'", html)
index.write_text(html, encoding='utf-8')
print('Versjon', version)
