"""Author the 19.8s music-led portrait story from current, verified app footage."""
from pathlib import Path
import html
import json

root = Path(__file__).resolve().parent
scenes = [
    dict(id='open',start=0,duration=2.4,title="Where's my bag?",rule='kinetic-beat-slam'),
    dict(id='tag',start=2.4,duration=3.0,title='One scan.',rule='device-frame-stage'),
    dict(id='message',start=5.4,duration=3.6,title='I found your backpack.',rule='device-frame-stage / touch-indicator'),
    dict(id='chat',start=9.0,duration=3.6,title='I can meet you there.',rule='device-frame-stage / touch-indicator'),
    dict(id='reward',start=12.6,duration=3.6,title='Backpack back. Finder rewarded.',rule='kinetic-beat-slam / device-frame-stage'),
    dict(id='close',start=16.2,duration=3.6,title='Lost. Found. Rewarded.',rule='kinetic-beat-slam'),
]
css = '''
@font-face{font-family:Arimo;src:url('assets/Arimo.ttf');font-weight:400 700}
@font-face{font-family:Archivo;src:url('assets/ArchivoBlack.ttf');font-weight:900}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:#0D1615;color:#F5FAF8;font-family:Arimo,sans-serif}
#root{position:relative;width:100%;height:100%;overflow:hidden}
.scene-surface{position:absolute;inset:0;background:#0D1615;overflow:hidden}
.paper{background:#EAF2EC;color:#0D1615}.cyan{background:#00BDCD;color:#0D1615}
.brand-mini{position:absolute;left:80px;top:166px;display:flex;align-items:center;gap:14px;font-size:34px;font-weight:700;letter-spacing:-1px}
.brand-mini img{width:36px;height:44px;object-fit:contain}
.eyebrow{position:absolute;right:80px;top:180px;font-size:23px;letter-spacing:2px;font-weight:700;margin:0}
.title{position:absolute;left:80px;right:80px;top:272px;margin:0;font-family:Archivo,sans-serif;font-size:144px;line-height:1.04;letter-spacing:-7px;font-weight:900}
.title span{display:block}.accent{color:#00BDCD}.quote{font-family:Arimo,sans-serif;font-weight:700;font-size:103px;line-height:1.04;letter-spacing:-4.5px;top:270px}
.phone-stage{position:absolute;left:0;right:0;top:502px;display:flex;justify-content:center}
.phone{position:relative;width:508px;padding:11px;border:2px solid #61756E;border-radius:52px;background:#151F1B;box-shadow:0 24px 38px #0003;flex:none}
.phone:after{content:'';position:absolute;right:-6px;top:210px;width:4px;height:96px;background:#61756E;border-radius:4px}
.screen{position:relative;width:482px;height:1071.111px;overflow:hidden;border-radius:38px;background:#0D1615}
.screen video{display:block;width:100%;height:100%;object-fit:contain}
.note{position:absolute;left:80px;right:80px;top:1650px;margin:0;text-align:center;font-size:32px;font-weight:700;letter-spacing:.2px}
.pair-stage{top:582px;gap:60px}.participant{width:424px}.participant .phone{width:424px;padding:9px;border-radius:44px}
.participant .screen{width:402px;height:893.333px;border-radius:32px}
.participant-label{font-size:26px;font-weight:700;letter-spacing:2.5px;margin:0 0 20px;text-align:center}
.touch{position:absolute;width:36px;height:36px;margin:-18px;border-radius:50%;opacity:0;pointer-events:none;z-index:4;background:#F5FAF888;border:3px solid #00BDCD;box-shadow:0 0 0 5px #00BDCD33}
.open-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.open-title{position:absolute;left:78px;right:78px;top:258px;margin:0;color:#0D1615;font-family:Archivo,sans-serif;font-weight:900;font-size:166px;line-height:1.03;letter-spacing:-8px}
.open-title span{display:block}.open-title .question{font-size:198px;letter-spacing:-10px;margin-top:6px}
.open-tag{position:absolute;left:80px;top:154px;font-size:25px;font-weight:700;letter-spacing:2.3px;color:#0D1615;margin:0}
.open-note{position:absolute;left:80px;bottom:224px;background:#00BDCD;color:#0D1615;padding:15px 24px;font-size:28px;font-weight:700;border-radius:6px}
.reward-title{font-size:102px;line-height:1.02;top:265px;letter-spacing:-4px}
.reward-stage{top:570px}.reward-stage .phone{width:452px;padding:10px;border-radius:47px}
.reward-stage .screen{width:428px;height:951.111px;border-radius:34px}
.reward-note{top:1608px;font-size:31px}.devnet{position:absolute;left:80px;right:80px;top:1660px;text-align:center;font-size:27px;margin:0;font-weight:400}
.close-brand{position:absolute;left:80px;top:230px;display:flex;align-items:center;gap:23px;font-size:70px;letter-spacing:-3px;font-weight:700}
.close-brand img{width:62px;height:76px}
.close-stack{position:absolute;left:80px;right:80px;top:526px;font-family:Archivo,sans-serif;font-size:140px;line-height:1.18;letter-spacing:-8px;font-weight:900}
.close-stack span{display:block}.close-link{position:absolute;left:84px;top:1250px;font-size:45px;font-weight:700;letter-spacing:-1.4px;margin:0}
.close-support{position:absolute;left:84px;top:1330px;font-size:28px;margin:0}
.close-line{position:absolute;left:84px;top:1435px;width:160px;height:7px;background:#0D1615;transform-origin:left center}
.wipe{position:absolute;inset:0;background:#00BDCD;pointer-events:none}
'''

def phone(uid,clip,offset,duration,js,width=482,role=None,touches=()):
    content=f'<video id="{uid}-video" class="clip" src="assets/{clip}.mp4" muted playsinline data-start="0" data-duration="{duration}" data-media-start="{offset}" data-playback-rate="1" data-volume="0" data-track-index="2"></video>'
    for n,(time,x,y) in enumerate(touches):
        at=time-offset
        if not 0 <= at < duration-.25: continue
        tid=f'{uid}-touch-{n}'
        content+=f'<div id="{tid}" class="touch" style="left:{x/1080*width:.3f}px;top:{y/1080*width:.3f}px" data-layout-ignore></div>'
        js+=f'tl.fromTo("#{tid}",{{opacity:0,scale:1.15}},{{opacity:1,scale:.82,duration:.07,ease:"power2.out",immediateRender:false}},{at-.04});tl.to("#{tid}",{{scale:1,opacity:0,duration:.17,ease:"power2.out"}},{at+.05});'
    out=f'<div id="{uid}" class="phone"><div class="screen">{content}</div></div>'
    if role: out=f'<div class="participant"><p class="participant-label">{role}</p>{out}</div>'
    return out,js

def brand(extra=''):
    return f'<div class="brand-mini"><img src="assets/logo.svg" alt="">SeekerTag</div><p class="eyebrow" data-layout-allow-occlusion>{extra}</p>'

hosts=[]
board=['# Where\'s my bag?','19.8s · 1080×1920 · music and SFX, no voiceover','']
for number,s in enumerate(scenes,1):
    sid='promo-'+s['id'];dur=s['duration'];js='const tl=gsap.timeline({paused:true});'
    if s['id']=='open':
        body='<div class="scene-surface paper"><img class="open-photo" src="assets/backpack-cafe.png" alt=""><p class="open-tag">YOU KNOW THAT FEELING.</p><h1 class="open-title"><span>WHERE’S</span><span class="question">MY BAG?</span></h1><div class="open-note">Left at the café.</div></div>'
        js+='tl.fromTo(".question",{y:65,rotation:3,opacity:0},{y:0,rotation:0,opacity:1,duration:.36,ease:"back.out(1.1)"},.22);tl.fromTo(".open-note",{x:-32,opacity:0},{x:0,opacity:1,duration:.3,ease:"power3.out"},1.15);'
    elif s['id']=='tag':
        frame,js=phone(sid+'-phone','unique-qr',.2,dur,js)
        body=f'<div class="scene-surface">{brand("QR + NFC")}<h1 class="title"><span>ONE <span class="accent" style="display:inline">SCAN.</span></span></h1><div class="phone-stage">{frame}</div><p class="note">Give your things a way back.</p></div>'
        js+=f'tl.fromTo("#{sid}-phone",{{y:90,rotation:-2}},{{y:0,rotation:0,duration:.46,ease:"power3.out"}},0);tl.fromTo(".title",{{x:-70}},{{x:0,duration:.4,ease:"expo.out"}},0);'
    elif s['id']=='message':
        frame,js=phone(sid+'-phone','owner-notification',1.4,dur,js,touches=[(2.398,830.7,195.96),(4.377,450,602.25)])
        body=f'<div class="scene-surface paper">{brand("A MESSAGE COMES IN")}<h1 class="title quote"><span>“I found your</span><span>backpack.”</span></h1><div class="phone-stage">{frame}</div><p class="note">A real person. A private conversation.</p></div>'
        js+='tl.fromTo(".quote",{y:24},{y:0,duration:.35,ease:"power2.out"},0);'
    elif s['id']=='chat':
        owner,js=phone(sid+'-owner','chat-owner-receive',5.9,dur,js,width=402,role='YOU')
        finder,js=phone(sid+'-finder','chat-finder-send',3.5,dur,js,width=402,role='THE FINDER',touches=[(4.92,950,2210)])
        body=f'<div class="scene-surface">{brand("MAKE THE CONNECTION")}<h1 class="title quote"><span>“I can meet</span><span class="accent">you there.”</span></h1><div class="phone-stage pair-stage">{owner}{finder}</div><p class="note">No phone numbers exchanged.</p></div>'
        js+=f'tl.fromTo("#{sid}-owner",{{x:110}},{{x:0,duration:.46,ease:"power3.out"}},0);tl.fromTo("#{sid}-finder",{{x:230}},{{x:0,duration:.52,ease:"power3.out"}},0);'
    elif s['id']=='reward':
        frame,js=phone(sid+'-phone','reward-paid',.75,dur,js,width=428)
        body=f'<div class="scene-surface paper">{brand("THE RETURN")}<h1 class="title reward-title"><span>BAG BACK.</span><span>REWARD PAID.</span></h1><div class="phone-stage reward-stage">{frame}</div><p class="note reward-note">0.95 SKR to the finder. Thank you, on-chain.</p><p class="devnet">Demo on devnet · test SKR</p></div>'
        js+='tl.fromTo(".reward-title span:nth-child(2)",{x:-45,opacity:0},{x:0,opacity:1,duration:.35,ease:"expo.out"},.3);'
    else:
        body='<div class="scene-surface cyan"><div class="close-brand"><img src="assets/logo.svg" alt="">SeekerTag</div><div class="close-stack"><span class="lost-word">LOST.</span><span class="found-word">FOUND.</span><span class="reward-word">REWARDED.</span></div><p class="close-link">seekertag.vercel.app ↗</p><p class="close-support">Built for Solana Seeker · Android</p><div class="close-line"></div></div>'
        js+='tl.fromTo(".lost-word",{y:-45},{y:0,duration:.3,ease:"power4.out"},0);tl.fromTo(".found-word",{x:-70,opacity:0},{x:0,opacity:1,duration:.36,ease:"expo.out"},.28);tl.fromTo(".reward-word",{y:65,rotation:3,opacity:0},{y:0,rotation:0,opacity:1,duration:.38,ease:"back.out(1.05)"},.62);tl.fromTo(".close-link,.close-support",{y:20,opacity:0},{y:0,opacity:1,duration:.28,stagger:.06,ease:"power2.out"},1);tl.fromTo(".close-line",{scaleX:0},{scaleX:1,duration:.38,ease:"power2.inOut"},1.15);'
    doc=f'<!doctype html><html lang="en"><body><template><style>#root{{position:absolute;inset:0;width:100%;height:100%}}</style><div id="root" data-composition-id="{sid}" data-width="1080" data-height="1920" data-duration="{dur}">{body}</div><script>{js}window.__timelines["{sid}"]=tl;</script></template></body></html>'
    (root/'compositions'/f'{sid}.html').write_text(doc+'\n')
    hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{s["start"]}" data-duration="{dur}" data-width="1080" data-height="1920" data-track-index="0"></div>')
    board.append(f'## Frame {number}\nstatus: built\nsrc: compositions/{sid}.html\nStart: {s["start"]}s · Duration: {dur}s\nRules: {s["rule"]}; matched hard cut (directional wipe only at 2.4s and 16.2s).\n{s["title"]}\n')

transjs='const tl=gsap.timeline({paused:true});'
for i,scene in enumerate([scenes[1], scenes[-1]]):
    at=scene['start']
    transjs+=f'tl.fromTo(".wipe",{{x:-1080}},{{x:0,duration:.18,ease:"power2.in",immediateRender:{"true" if i==0 else "false"}}},{at-.18});tl.fromTo(".wipe",{{x:0}},{{x:1080,duration:.22,ease:"power2.out",immediateRender:false}},{at});'
(root/'compositions'/'promo-transitions.html').write_text(f'<!doctype html><html><body><template><div id="root" data-composition-id="promo-transitions" data-width="1080" data-height="1920" data-duration="19.8" style="position:absolute;inset:0;background:transparent;pointer-events:none"><div class="wipe" data-layout-ignore data-layout-allow-occlusion></div></div><script>{transjs}window.__timelines["promo-transitions"]=tl;</script></template></body></html>\n')
hosts.append('<div id="promo-transitions" class="clip" data-composition-id="promo-transitions" data-composition-src="compositions/promo-transitions.html" data-start="0" data-duration="19.8" data-width="1080" data-height="1920" data-track-index="8"></div>')
gain = html.escape(json.dumps({'version':1,'nodes':[{'id':'final-level','type':'gain','params':{'gain':3}}]}), quote=True)
audio=f'<hf-audio-group id="promo-mix" data-fx-chain="{gain}"></hf-audio-group><audio id="music" data-audio-group="promo-mix" src="assets/music.wav" data-start="0" data-duration="19.8" data-volume="1" data-track-index="20"></audio><audio id="sound-design" data-audio-group="promo-mix" src="assets/sound-design.wav" data-start="0" data-duration="19.8" data-volume="1" data-track-index="21"></audio>'
(root/'index.html').write_text(f'<!doctype html><html lang="en"><head><meta charset="UTF-8"><script src="assets/gsap.min.js"></script><style>{css}</style></head><body><div id="root" data-composition-id="seekertag-promo" data-width="1080" data-height="1920" data-duration="19.8" data-fps="30">{"".join(hosts)}{audio}</div><script>window.__timelines["seekertag-promo"]=gsap.timeline({{paused:true}});</script></body></html>\n')
(root/'STORYBOARD.md').write_text('\n'.join(board))
(root/'timing.json').write_text(json.dumps({'duration':19.8,'width':1080,'height':1920,'fps':30,'scenes':scenes},indent=2)+'\n')
# Accessibility subtitles describe the editorial text; this cut has no speech.
captions=[('Where’s my bag?\nLeft at the café.',0,2.4),('One scan.\nQR + NFC tags.',2.4,5.4),('“I found your backpack.”',5.4,9),('“I can meet you there.”\nPrivate chat. No phone numbers exchanged.',9,12.6),('Backpack back. Finder rewarded.\n0.95 test SKR to the finder · Devnet demo',12.6,16.2),('SeekerTag. Lost. Found. Rewarded.\nseekertag.vercel.app',16.2,19.8)]
def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(root/'seekertag-promo-en-vertical.srt').write_text('\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n' for i,(text,a,b) in enumerate(captions,1)))
print('Authored six story beats, covered cuts and exact recorded press markers.')
