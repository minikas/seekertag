"""Freeze HyperFrames carve attributes so author-promo.py preserves the mix."""
from html.parser import HTMLParser
from pathlib import Path
import json

root = Path(__file__).resolve().parent

class MixParser(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'audio' and attrs.get('id') == 'music-bed':
            mix = {key: json.loads(attrs[key]) for key in ('data-fx-chain', 'data-fx-carve', 'data-automation')}
            (root/'audio-mix.json').write_text(json.dumps(mix, indent=2)+'\n')

MixParser().feed((root/'index.html').read_text())
