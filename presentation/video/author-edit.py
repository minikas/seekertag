from pathlib import Path
import html, json

root = Path(__file__).resolve().parent
project = root / 'edit'
timing = json.loads((root / 'edit-timing.json').read_text())
cuts = json.loads((root / 'cuts.json').read_text())

# Material adapted from the installed upstream device-frame-stage component.
# Camera structure follows coordinate-target-zoom: outer scale, inner translate.
css = '''
*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#0D1615;color:#F5FAF8;font-family:Arial,sans-serif}
#root{position:relative;width:100%;height:100%}.clip{position:absolute}
.chapter{position:absolute;left:62px;top:31px;font-size:29px;line-height:40px;font-weight:600;max-width:1370px}
.edition{position:absolute;right:62px;top:39px;font-size:18px;letter-spacing:1.5px;color:#BCD0CA;z-index:80}
.stage{position:absolute;left:0;top:78px;width:1920px;height:902px;overflow:hidden}
.camera{position:absolute;inset:0;transform-origin:50% 50%;will-change:transform}
.camera-inner{position:absolute;inset:0;will-change:transform}
.phone{position:absolute;left:750px;top:0;width:420px;height:904px;padding:12px;border-radius:52px;background:linear-gradient(145deg,#5e6665,#222b2a 23%,#0c1110 61%,#394240);border:1px solid #64716d;box-shadow:0 18px 45px #0008,0 4px 8px #0008,inset 0 1px 1px #ccd4d180,inset 0 0 0 3px #171e1c;transform-origin:50% 50%}
.phone:before{content:"";position:absolute;left:-5px;top:130px;width:5px;height:82px;background:linear-gradient(90deg,#222b28,#68736d);border-radius:3px 0 0 3px}
.phone:after{content:"";position:absolute;right:-5px;top:207px;width:5px;height:59px;background:linear-gradient(90deg,#68736d,#222b28);border-radius:0 3px 3px 0}
.screen{position:relative;width:394px;height:878px;overflow:hidden;border-radius:40px;background:#000;box-shadow:0 0 0 2px #020604}
.screen video{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
.actor{position:absolute;left:62px;top:99px;max-width:490px;font-size:21px;line-height:29px;color:#BCD0CA;z-index:70}
.pair-label{position:absolute;top:99px;width:600px;text-align:center;font-size:23px;line-height:29px;color:#BCD0CA;z-index:70}.stage.pair-stage{top:142px;height:838px}
.pair-camera{position:absolute;left:0;top:0;width:960px;height:838px;overflow:hidden;transform-origin:50% 50%}
.pair-camera.right{left:960px}.pair-camera .phone{left:270px;transform:scale(.92);transform-origin:50% 0}
.caption{left:72px;right:72px;top:990px;height:83px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:29px;line-height:1.22;font-weight:500;z-index:100;padding:0 22px;background:#0D1615}
.progress-rail{position:absolute;left:62px;top:983px;width:1796px;height:2px;background:#304540;z-index:90}.progress{height:2px;background:#00BDCD;transform-origin:left}
'''

focus = {'welcome':(1,1200),'sign-options':(1.7,1800),'seed-vault-login':(1.7,1900),'my-items':(1.55,760),'item-name':(1.6,650),'private-note':(1.65,1060),'public-message':(1.65,1510),'reward-period':(1.65,1000),'deposit-review':(1.55,1330),'deposit-sign':(1.75,1910),'deposit-confirm':(1.55,1050),'reward-reserved':(1.6,1910),'unique-qr':(1.6,1040),'download-pdf':(1.5,1720),'pdf-preview':(1.55,1330),'nfc-ready':(1.65,1830),'finder-tag':(1.55,1160),'finder-notify':(1.55,1300),'finder-connect':(1.6,1850),'finder-wallet-sign':(1.45,1600),'recipient-verified':(1.6,1920),'finish-return':(1.65,1940),'payout-review':(1.65,1450),'payout-sign':(1.65,1940),'reward-paid':(1.7,1940)}

def phone(uid, media):
    videos=[]
    for index,c in enumerate(media):
        videos.append(f'<video id="{uid}-{c["id"]}" class="clip" src="assets/{c["id"]}.mp4" muted playsinline data-start="{c["start"]}" data-duration="{c["duration"]}" data-track-index="{index+2}" data-hf-media-start-basis="local"></video>')
    return f'<div id="{uid}-phone" class="phone" data-layout-allow-overflow><div class="screen">'+''.join(videos)+'</div></div>'

hosts=[];board=['# Smartphone demonstration — 160 seconds\n']
for index, scene in enumerate(timing['scenes']):
    sid=scene['id'];sc=[c for c in cuts if c['scene']==sid];solo=[c for c in sc if not ('chat-' in c['id'])];pair=[c for c in sc if 'chat-' in c['id']]
    parts=[f'<div class="chapter">{index+1:02} / {html.escape(scene["title"])}</div>']
    js=['const tl=gsap.timeline({paused:true});']
    if solo:
        parts.append(f'<div id="{sid}-solo-stage" class="stage"><div id="{sid}-camera" class="camera" data-layout-allow-overflow><div id="{sid}-inner" class="camera-inner">{phone(sid,solo)}</div></div></div>')
        end=max(c['start']+c['duration'] for c in solo)
        if pair:
            js.append(f'tl.set("#{sid}-solo-stage",{{opacity:0}},{end});')
        js.append(f'tl.fromTo("#{sid}-phone",{{y:32,scale:.92,opacity:0}},{{y:0,scale:1,opacity:1,duration:.55,ease:"power3.out"}},0);')
        for c in solo:
            start=c['start'];d=c['duration'];zoom,target=focus.get(c['id'],(1.55,1300));shift=451-(12+target*(878/2400))
            # Explicit neutral pose at the cut; focus lands in ~1s, then holds.
            js.append(f'tl.set("#{sid}-camera",{{scale:1}},{start});tl.set("#{sid}-inner",{{y:0}},{start});')
            if zoom>1 and d>=3:
                move=min(1.0,d*.25);at=start+.55;out=start+d-.65
                js.append(f'tl.to("#{sid}-camera",{{scale:{zoom},duration:{move},ease:"power3.inOut"}},{at});tl.to("#{sid}-inner",{{y:{shift:.3f},duration:{move},ease:"power3.inOut"}},{at});')
                if d>=5:
                    js.append(f'tl.to("#{sid}-camera",{{scale:1,duration:.6,ease:"power3.inOut"}},{out});tl.to("#{sid}-inner",{{y:0,duration:.6,ease:"power3.inOut"}},{out});')
            label=c['label']
            if c['id']=='finder-wallet-sign':label='Verification retake · Seeker / Testuser'
            if c['id']=='nfc-ready':label='NFC writing screen · no physical tag used'
            parts.append(f'<div id="{sid}-{c["id"]}-actor" class="clip actor" data-start="{start}" data-duration="{d}" data-track-index="30">{html.escape(label)}</div>')
    if pair:
        first=min(c['start'] for c in pair)
        pairparts=[]
        for role, x in [('owner',0),('finder',960)]:
            media=[c for c in pair if role in c['id']]
            uid=f'{sid}-{role}';side=' right' if x else ''
            pairparts.append(f'<div id="{uid}-camera" class="pair-camera{side}"><div id="{uid}-inner" class="camera-inner">{phone(uid,media)}</div></div>')
            js.append(f'tl.fromTo("#{uid}-phone",{{x:{-60 if not x else 60},opacity:0}},{{x:0,opacity:1,duration:.6,ease:"power3.out"}},{first});')
            # These are two genuine actors, never a duplicate enlargement.
            text='Owner · Solana Seeker' if role=='owner' else 'Finder · separate Android session'
            parts.append(f'<div id="{uid}-label" class="clip pair-label" style="left:{180+x}px" data-start="{first}" data-duration="{scene["duration"]-first}" data-track-index="31">{text}</div>')
        parts.append(f'<div id="{sid}-pair-stage" class="stage pair-stage">'+''.join(pairparts)+'</div>')
        js.append(f'tl.fromTo("#{sid}-pair-stage",{{opacity:0}},{{opacity:1,duration:.3}},{first});')
    js.append(f'window.__timelines["{sid}"]=tl;')
    content=''.join(parts)
    (project/'compositions'/f'{sid}.html').write_text(f'<!doctype html><html lang="en"><body><template><style>#{sid}-root{{position:absolute;inset:0;width:100%;height:100%;background:#0D1615}}</style><div id="{sid}-root" data-composition-id="{sid}" data-width="1920" data-height="1080" data-duration="{scene["duration"]}">{content}</div><script>'+''.join(js)+'</script></template></body></html>')
    hosts.append(f'<div id="{sid}-host" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{scene["start"]}" data-duration="{scene["duration"]}" data-track-index="0" data-width="1920" data-height="1080"></div>')
    board.append(f'## Frame {index+1}\nstatus: built\nsrc: compositions/{sid}.html\nDuration: {scene["duration"]} seconds\nRules: device-frame-stage, coordinate-target-zoom, spring-pop-entrance\n{scene["title"]}. Genuine footage; one smartphone per actor.\n')

for i,c in enumerate(timing['captions']):hosts.append(f'<div id="caption-{i}" class="clip caption" data-start="{c["start"]}" data-duration="{c["duration"]}" data-track-index="50">{html.escape(c["text"])}</div>')
hosts.append('<div class="edition">SEEKERTAG · SOLANA DEVNET</div><audio id="narration" src="assets/narration.wav" data-start="0" data-duration="160" data-track-index="60" data-volume="1"></audio><div class="progress-rail"><div class="progress"></div></div>')
(project/'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="UTF-8"><script src="assets/gsap.min.js"></script><style>'+css+'</style></head><body><div id="root" data-composition-id="seekertag-smartphone-demo" data-width="1920" data-height="1080" data-duration="160" data-fps="30">'+''.join(hosts)+'</div><script>const tl=gsap.timeline({paused:true});tl.fromTo(".progress",{scaleX:0},{scaleX:1,duration:160,ease:"none"},0);window.__timelines["seekertag-smartphone-demo"]=tl;</script></body></html>')
(project/'STORYBOARD.md').write_text('\n'.join(board))
print('Six smartphone scenes authored; no duplicated detail panel.')
