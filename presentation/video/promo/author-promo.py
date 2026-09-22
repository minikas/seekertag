"""Rebuild the 19.8-second portrait cut from verified app recordings."""
from pathlib import Path
import html
import json

root = Path(__file__).resolve().parent
scenes = [
    dict(id='open', start=0, duration=4.2, lines=['Lost happens.', 'Connection stays.'], note='Your things deserve a way back.'),
    dict(id='tag', start=4.2, duration=4.2, lines=['One tag.', 'A way back.'], note='QR + NFC · Printable labels'),
    dict(id='chat', start=8.4, duration=4.2, lines=['A stranger.', 'A connection.'], note='Private chat. Real people.'),
    dict(id='reward', start=12.6, duration=3.6, lines=['Kindness.', 'Rewarded.'], note='SKR rewards, secured on Solana.'),
    dict(id='close', start=16.2, duration=3.6, lines=['What is yours.', 'Back to you.'], note='seekertag.vercel.app'),
]
css = '''
@font-face{font-family:PromoArial;src:url('assets/Arimo.ttf');font-weight:400 700}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:#0D1615;font-family:PromoArial,sans-serif;color:#F5FAF8}
#root{position:relative;width:100%;height:100%;overflow:hidden;background:#0D1615}
.background{position:absolute;inset:0;background:#0D1615}
.route-shape{position:absolute;inset:0;width:1080px;height:1920px;opacity:.52}
.brand{position:absolute;left:90px;top:174px;display:flex;gap:18px;align-items:center;height:64px;font-size:42px;font-weight:700;letter-spacing:-1.6px}
.brand img{width:46px;height:56px;object-fit:contain}
.chapter{position:absolute;right:90px;top:193px;color:#BCD0CA;font-size:25px;letter-spacing:3px}
.heading{position:absolute;left:90px;right:90px;top:294px;margin:0;font-weight:700;font-size:96px;line-height:1.01;letter-spacing:-4.8px}
.line{display:block}.line+.line{margin-top:7px;color:#00BDCD}
.feature-stage{position:absolute;left:90px;right:90px;top:548px;display:flex;justify-content:center;align-items:flex-start;gap:48px}
.phone{position:relative;width:438px;padding:11px;border:2px solid #64716D;border-radius:52px;background:linear-gradient(145deg,#394240,#171e1c 50%,#0c1110);box-shadow:0 22px 46px #0008}
.phone:after{content:'';position:absolute;right:-6px;top:195px;width:4px;height:100px;background:#64716D;border-radius:3px}
.screen{position:relative;width:412px;height:916px;overflow:hidden;border-radius:38px;background:#0D1615}
.screen video{display:block;width:100%;height:100%;object-fit:contain}
.duo-stage{top:618px;gap:58px}.participant{width:374px;position:relative}
.participant-label{margin:0 0 20px;color:#BCD0CA;text-align:center;font-size:28px;font-weight:700;letter-spacing:2px}
.participant .phone{width:374px;padding:9px;border-radius:45px}.participant .screen{width:352px;height:782px;border-radius:33px}
.note{position:absolute;left:90px;right:90px;top:1575px;margin:0;text-align:center;font-size:35px;line-height:1.25;color:#BCD0CA}
.proof-label{position:absolute;left:90px;right:90px;top:1632px;text-align:center;margin:0;font-size:26px;color:#BCD0CA}
.close-group{position:absolute;left:90px;right:90px;top:520px}
.close-brand{display:flex;align-items:center;gap:26px;margin-bottom:78px;font-size:92px;font-weight:700;letter-spacing:-4px}
.close-brand img{width:88px;height:106px;object-fit:contain}
.close-heading{margin:0;font-size:112px;line-height:1.02;letter-spacing:-5.5px;font-weight:700}
.close-link{margin:64px 0 0;color:#F5FAF8;font-size:42px;letter-spacing:-.7px}
.close-support{margin:26px 0 0;color:#BCD0CA;font-size:31px}
.close-rule{margin-top:60px;width:160px;height:6px;background:#00BDCD;transform-origin:left center}
'''

def phone(sid, clip, offset, duration, rate=1, role=None):
    uid = f'{sid}-{role or "phone"}'
    frame = f'''<div id="{uid}" class="phone"><div class="screen"><video id="{uid}-video" class="clip" src="assets/{clip}.mp4" data-start="0" data-duration="{duration}" data-media-start="{offset}" data-playback-rate="{rate}" data-track-index="1" data-volume="0" muted playsinline></video></div></div>'''
    return f'<div class="participant"><p class="participant-label">{role.upper()}</p>{frame}</div>' if role else frame

hosts = []
board = ['# SeekerTag — A way back', 'Vertical 1080 × 1920 · 19.8 seconds · 30 fps', '']
for scene in scenes:
    sid, dur = 'promo-' + scene['id'], scene['duration']
    heading = ''.join(f'<span class="line">{html.escape(line)}</span>' for line in scene['lines'])
    if scene['id'] == 'close':
        content = f'''<div class="close-group"><div class="close-brand"><img src="assets/logo.svg" alt="">SeekerTag</div><h1 class="close-heading">{heading}</h1><p class="close-link">seekertag.vercel.app</p><p class="close-support">Built for Solana Seeker · Android</p><div class="close-rule"></div></div>'''
        motion = f'''tl.fromTo(".close-brand",{{x:-28,opacity:0}},{{x:0,opacity:1,duration:.48,ease:"power3.out"}},0);
tl.fromTo(".line",{{x:-32,opacity:0}},{{x:0,opacity:1,duration:.45,stagger:.09,ease:"power3.out"}},.14);
tl.fromTo(".close-link,.close-support",{{y:18,opacity:0}},{{y:0,opacity:1,duration:.35,stagger:.08,ease:"power2.out"}},.55);
tl.fromTo(".close-rule",{{scaleX:0}},{{scaleX:1,duration:.65,ease:"power2.inOut"}},.65);'''
    else:
        if scene['id'] == 'chat':
            phones = phone(sid, 'chat-owner-receive', 5.2, dur, role='owner') + phone(sid, 'chat-finder-receive', 4.7, dur, role='finder')
            stage = 'feature-stage duo-stage'
        else:
            clip, offset, rate = {'open':('my-items',0,.8), 'tag':('unique-qr',0,.8), 'reward':('reward-paid',0,1)}[scene['id']]
            phones = phone(sid, clip, offset, dur, rate)
            stage = 'feature-stage'
        proof = '<p class="proof-label">Demo on devnet · test SKR</p>' if scene['id']=='reward' else ''
        content = f'<h1 class="heading">{heading}</h1><div class="{stage}">{phones}</div><p class="note">{scene["note"]}</p>{proof}'
        motion = '''tl.fromTo(".line",{x:-32,opacity:0},{x:0,opacity:1,duration:.4,stagger:.08,ease:"power3.out"},.02);
tl.fromTo(".note,.proof-label",{y:12,opacity:0},{y:0,opacity:1,duration:.32,stagger:.05,ease:"power2.out"},.35);'''
        if scene['id']=='chat':
            motion += f'''tl.fromTo("#{sid}-owner",{{x:-38,y:14,opacity:0}},{{x:0,y:0,opacity:1,duration:.48,ease:"power3.out"}},.02);
tl.fromTo("#{sid}-finder",{{x:38,y:14,opacity:0}},{{x:0,y:0,opacity:1,duration:.48,ease:"power3.out"}},.10);'''
        else:
            motion += f'tl.fromTo("#{sid}-phone",{{y:32,opacity:0}},{{y:0,opacity:1,duration:.48,ease:"power3.out"}},.02);'
        motion += f'tl.to(".heading,.feature-stage,.note,.proof-label",{{opacity:0,y:-10,duration:.16,ease:"power2.in"}},{dur-.16});'
        if scene['id']=='open':
            # Keep the hook readable on frame zero; only the second line reveals.
            motion = motion.replace('tl.fromTo(".line",', 'tl.fromTo(".line:nth-child(2)",')
    scene_html = f'''<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body><template>
<style>#root{{position:absolute;inset:0;width:100%;height:100%}}</style>
<div id="root" data-composition-id="{sid}" data-width="1080" data-height="1920" data-duration="{dur}">{content}</div>
<script>const tl=gsap.timeline({{paused:true}});{motion}window.__timelines["{sid}"]=tl;</script>
</template></body></html>'''
    (root/'compositions'/f'{sid}.html').write_text(scene_html)
    hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{scene["start"]}" data-duration="{dur}" data-track-index="0" data-width="1080" data-height="1920"></div>')
    board.append(f'## Frame {len(board)-2}\nstatus: built\nsrc: compositions/{sid}.html\nStart: {scene["start"]}s · Duration: {dur}s\nRules: device-frame-stage, line-by-line-slide.\n{" / ".join(scene["lines"])}\n{scene["note"]}\n')

background = '''<div class="background"></div><svg class="route-shape" viewBox="0 0 1080 1920" data-layout-ignore aria-hidden="true"><path id="return-route" d="M 120 1750 C 840 1670 1060 1120 860 700 C 670 280 300 280 120 580" fill="none" stroke="#304540" stroke-width="3"/><rect id="tag-outline" x="170" y="460" width="740" height="1110" rx="180" fill="none" stroke="#304540" stroke-width="3"/></svg>'''
(root/'compositions'/'promo-brand.html').write_text('''<!doctype html><html lang="en"><head><meta charset="UTF-8"></head><body><template><div id="root" data-composition-id="promo-brand" data-width="1080" data-height="1920" data-duration="16.2" style="position:absolute;inset:0;background:transparent"><div class="brand"><img src="assets/logo.svg" alt="">SeekerTag</div><div class="chapter">A WAY BACK</div></div><script>window.__timelines["promo-brand"]=gsap.timeline({paused:true});</script></template></body></html>''')
brand = '<div id="promo-brand" class="clip" data-composition-id="promo-brand" data-composition-src="compositions/promo-brand.html" data-start="0" data-duration="16.2" data-width="1080" data-height="1920" data-track-index="10"></div>'
automation = html.escape(json.dumps({'version':1,'lanes':[{'target':'volume','points':[{'t':0,'v':0},{'t':.3,'v':.45},{'t':18.8,'v':.45},{'t':19.8,'v':0}]}]}), quote=True)
audio = f'<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="19.8" data-track-index="20" data-volume="1"></audio><audio id="music-bed" src="assets/music.wav" data-start="0" data-duration="19.8" data-track-index="21" data-volume="0.45" data-automation="{automation}"></audio>'
voice_fx = html.escape(json.dumps({'version':1,'nodes':[
    {'id':'voice-level','type':'compressor','label':'Clear mobile narration','params':{'threshold':-17,'ratio':3,'attack':5,'release':90,'knee':3,'makeup':7.5,'mix':1}},
    {'id':'voice-ceiling','type':'limiter','label':'Voice peak ceiling','params':{'limit':-1.7,'attack':3,'release':70,'level_out':0}}
]}), quote=True)
audio = audio.replace('id="narration"', f'id="narration" data-fx-chain="{voice_fx}"')
if (root/'audio-mix.json').exists():
    mix = json.loads((root/'audio-mix.json').read_text())
    attributes = ' '.join(f'{key}="{html.escape(json.dumps(value, separators=(",", ":")), quote=True)}"' for key, value in mix.items())
    audio = audio.replace(f'data-automation="{automation}"', attributes)
(root/'index.html').write_text(f'''<!doctype html><html lang="en"><head><meta charset="UTF-8"><script src="assets/gsap.min.js"></script><style>{css}</style></head><body><div id="root" data-composition-id="seekertag-promo" data-width="1080" data-height="1920" data-duration="19.8" data-fps="30">{background}{''.join(hosts)}{brand}{audio}</div><script>const tl=gsap.timeline({{paused:true}});tl.fromTo("#tag-outline",{{y:26,rotation:-5}},{{y:-18,rotation:3,duration:19.8,ease:"sine.inOut"}},0);tl.fromTo("#return-route",{{opacity:.55}},{{opacity:1,duration:9.9,yoyo:true,repeat:1,ease:"sine.inOut"}},0);window.__timelines["seekertag-promo"]=tl;</script></body></html>''')
(root/'STORYBOARD.md').write_text('\n'.join(board))
(root/'timing.json').write_text(json.dumps({'duration':19.8,'width':1080,'height':1920,'fps':30,'scenes':scenes},indent=2)+'\n')
print('Authored five portrait scenes, 19.8 seconds.')
