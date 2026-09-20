from pathlib import Path
import html, json

root = Path(__file__).resolve().parent
project = root / 'edit'
timing = json.loads((root / 'edit-timing.json').read_text())
cuts = json.loads((root / 'cuts.json').read_text())
motion = json.loads((root / 'motion.json').read_text())
duration = timing['duration']

# Material adapted from the installed upstream device-frame-stage component.
# Camera containers remain stable; this edit has no editorial zooms.
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
.touch-marker{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;z-index:50;pointer-events:none;opacity:0;will-change:transform,opacity}
.touch-core{position:absolute;inset:0;border-radius:50%;border:1.5px solid #F5FAF8;background:#00BDCD33;box-shadow:0 1px 5px #0008;will-change:transform}
.actor{position:absolute;left:62px;top:99px;max-width:490px;font-size:21px;line-height:29px;color:#BCD0CA;z-index:70}
.pair-label{position:absolute;top:99px;width:600px;text-align:center;font-size:23px;line-height:29px;color:#BCD0CA;z-index:70}.stage.pair-stage{top:142px;height:838px}
.pair-camera{position:absolute;left:0;top:0;width:960px;height:838px;overflow:hidden;transform-origin:50% 50%}
.pair-camera.right{left:960px}.pair-camera .phone{left:270px;transform:scale(.92);transform-origin:50% 0}
.caption{left:72px;right:72px;top:990px;height:83px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:29px;line-height:1.22;font-weight:500;z-index:100;padding:0 22px;background:#0D1615}
.progress-rail{position:absolute;left:62px;top:983px;width:1796px;height:2px;background:#304540;z-index:90}.progress{height:2px;background:#00BDCD;transform-origin:left}
'''

def phone(uid, media, js):
    videos=[]
    for index,c in enumerate(media):
        videos.append(f'<video id="{uid}-{c["id"]}" class="clip" src="assets/{c["id"]}.mp4" muted playsinline data-start="{c["start"]}" data-duration="{c["duration"]}" data-track-index="{index+2}" data-hf-media-start-basis="local"></video>')
    # Adapt the upstream touch-indicator contact/compress/release/lift anatomy.
    # These editorial markers follow recorded controls, inside the same screen
    # as the footage, so camera moves never detach a touch from its target.
    for index, event in enumerate(motion['touches']):
        clip = next((c for c in media if c['id'] == event['clip']), None)
        if clip is None:
            continue
        at = max(clip['start'], clip['start'] + event['at'] - .12)
        marker = f'{uid}-touch-{index}'
        x, y = event['x'] / 1080 * 394, event['y'] / 2400 * 878
        videos.append(f'<div id="{marker}" class="touch-marker" style="left:{x:.3f}px;top:{y:.3f}px" data-layout-ignore><div class="touch-core"></div></div>')
        js.append(f'tl.fromTo("#{marker}",{{opacity:0}},{{opacity:1,duration:.05,ease:"power2.out",immediateRender:false}},{at});')
        js.append(f'tl.fromTo("#{marker} .touch-core",{{scale:1.15}},{{scale:.82,duration:.07,ease:"power2.out",immediateRender:false}},{at});')
        js.append(f'tl.to("#{marker} .touch-core",{{scale:1,duration:.1,ease:"power2.out"}},{at+.08});')
        js.append(f'tl.to("#{marker}",{{opacity:0,duration:.08,ease:"power2.in"}},{at+.17});')
    return f'<div id="{uid}-phone" class="phone" data-layout-allow-overflow><div class="screen">'+''.join(videos)+'</div></div>'

hosts=[];board=[f'# Smartphone demonstration — {duration:g} seconds\n']
for index, scene in enumerate(timing['scenes']):
    sid=scene['id'];sc=[c for c in cuts if c['scene']==sid];solo=[c for c in sc if not ('chat-' in c['id'])];pair=[c for c in sc if 'chat-' in c['id']]
    parts=[f'<div class="chapter">{index+1:02} / {html.escape(scene["title"])}</div>']
    js=['const tl=gsap.timeline({paused:true});']
    if solo:
        parts.append(f'<div id="{sid}-solo-stage" class="stage"><div id="{sid}-camera" class="camera" data-layout-allow-overflow><div id="{sid}-inner" class="camera-inner">{phone(sid,solo,js)}</div></div></div>')
        end=max(c['start']+c['duration'] for c in solo)
        if pair:
            js.append(f'tl.set("#{sid}-solo-stage",{{opacity:0}},{end});')
        if index == 0:
            js.append(f'tl.fromTo("#{sid}-phone",{{y:14,opacity:0}},{{y:0,opacity:1,duration:.4,ease:"power2.out"}},0);')
        # One continuous camera per chapter. No neutral reset at every cut,
        # no repeated zoom-in/zoom-out cycle, and no zoom on waiting screens.
        for pose in motion['camera'].get(sid, []):
            shift = 0 if pose['zoom'] == 1 else 451 - (12 + pose['target_y'] * (878 / 2400))
            at, move, zoom = pose['at'], pose['duration'], pose['zoom']
            js.append(f'tl.to("#{sid}-camera",{{scale:{zoom},duration:{move},ease:"sine.inOut"}},{at});')
            js.append(f'tl.to("#{sid}-inner",{{y:{shift:.3f},duration:{move},ease:"sine.inOut"}},{at});')
        for c in solo:
            start=c['start'];d=c['duration']
            label=c['label']
            if c['id']=='nfc-ready':label='NFC writing screen · no physical tag used'
            parts.append(f'<div id="{sid}-{c["id"]}-actor" class="clip actor" data-start="{start}" data-duration="{d}" data-track-index="30">{html.escape(label)}</div>')
    if pair:
        first=min(c['start'] for c in pair)
        pairparts=[]
        for role, x in [('owner',0),('finder',960)]:
            media=[c for c in pair if role in c['id']]
            uid=f'{sid}-{role}';side=' right' if x else ''
            pairparts.append(f'<div id="{uid}-camera" class="pair-camera{side}"><div id="{uid}-inner" class="camera-inner">{phone(uid,media,js)}</div></div>')
            js.append(f'tl.fromTo("#{uid}-phone",{{x:{-20 if not x else 20},opacity:0}},{{x:0,opacity:1,duration:.4,ease:"power2.out",immediateRender:false}},{first});')
            # These are two genuine actors, never a duplicate enlargement.
            text='Owner · Solana Seeker' if role=='owner' else 'Finder · separate Android session'
            parts.append(f'<div id="{uid}-label" class="clip pair-label" style="left:{180+x}px" data-start="{first}" data-duration="{scene["duration"]-first}" data-track-index="31">{text}</div>')
        parts.append(f'<div id="{sid}-pair-stage" class="stage pair-stage">'+''.join(pairparts)+'</div>')
        js.append(f'tl.set("#{sid}-pair-stage",{{opacity:0}},0);')
        js.append(f'tl.set("#{sid}-pair-stage",{{opacity:1}},{first});')
    js.append(f'window.__timelines["{sid}"]=tl;')
    content=''.join(parts)
    (project/'compositions'/f'{sid}.html').write_text(f'<!doctype html><html lang="en"><body><template><style>#{sid}-root{{position:absolute;inset:0;width:100%;height:100%;background:#0D1615}}</style><div id="{sid}-root" data-composition-id="{sid}" data-width="1920" data-height="1080" data-duration="{scene["duration"]}">{content}</div><script>'+''.join(js)+'</script></template></body></html>')
    hosts.append(f'<div id="{sid}-host" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{scene["start"]}" data-duration="{scene["duration"]}" data-track-index="0" data-width="1920" data-height="1080"></div>')
    board.append(f'## Frame {index+1}\nstatus: built\nsrc: compositions/{sid}.html\nDuration: {scene["duration"]} seconds\nRules: device-frame-stage, touch-indicator\n{scene["title"]}. Recorded footage; one smartphone per actor; stable framing and native app movement.\n')

for i,c in enumerate(timing['captions']):hosts.append(f'<div id="caption-{i}" class="clip caption" data-start="{c["start"]}" data-duration="{c["duration"]}" data-track-index="50">{html.escape(c["text"])}</div>')
hosts.append(f'<div class="edition">SEEKERTAG · SOLANA DEVNET</div><audio id="narration" src="assets/narration.wav" data-start="0" data-duration="{duration}" data-track-index="60" data-volume="1"></audio><div class="progress-rail"><div class="progress"></div></div>')
(project/'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="UTF-8"><script src="assets/gsap.min.js"></script><style>'+css+f'</style></head><body><div id="root" data-composition-id="seekertag-smartphone-demo" data-width="1920" data-height="1080" data-duration="{duration}" data-fps="30">'+''.join(hosts)+f'</div><script>const tl=gsap.timeline({{paused:true}});tl.fromTo(".progress",{{scaleX:0}},{{scaleX:1,duration:{duration},ease:"none"}},0);window.__timelines["seekertag-smartphone-demo"]=tl;</script></body></html>')
(project/'STORYBOARD.md').write_text('\n'.join(board))

def stamp(seconds, separator):
    ms = round(seconds * 1000)
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}{separator}{ms:03}'

for suffix, separator in [('srt', ','), ('vtt', '.')]:
    entries = ['WEBVTT\n'] if suffix == 'vtt' else []
    for index, caption in enumerate(timing['captions'], 1):
        prefix = f'{index}\n' if suffix == 'srt' else ''
        entries.append(prefix + stamp(caption['start'], separator) + ' --> ' + stamp(caption['start'] + caption['duration'], separator) + '\n' + caption['text'] + '\n')
    (root / f'seekertag-seeker-demo-en.{suffix}').write_text('\n'.join(entries))
print('Six smartphone scenes authored; no duplicated detail panel.')
