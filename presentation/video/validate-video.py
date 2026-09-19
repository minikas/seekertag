"""Inspect the encoded deliverable and extract actual output frames for review."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
video = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'renders/seekertag-seeker-demo-en.mp4'
qa = root / 'qa'
qa.mkdir(exist_ok=True)
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)
]))
v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
a = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert (v['width'], v['height'], v['r_frame_rate']) == (1920, 1080, '30/1')
assert v['codec_name'] == 'h264' and a['codec_name'] == 'aac'
assert abs(float(probe['format']['duration']) - 160) < 0.1
assert int(v['nb_frames']) == 4800 and abs(float(v['duration']) - 160) < 0.1
decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], capture_output=True, text=True)
assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr

timing = json.loads((root / 'edit-timing.json').read_text())
cuts = json.loads((root / 'cuts.json').read_text())
starts = {s['id']: s['start'] for s in timing['scenes']}
samples = {round(starts[c['scene']] + c['start'] + min(1.5, c['duration'] / 2), 3): c['id'] for c in cuts}
samples[159.5] = 'last-frame'
frames = []
for i, (time, label) in enumerate(sorted(samples.items())):
    path = qa / f'frame-{i:02}-{time:g}s.jpg'
    subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(time), '-i', str(video), '-frames:v', '1', '-vf', 'scale=in_range=tv:out_range=pc,format=yuvj420p', '-color_range', 'pc', '-q:v', '2', '-y', str(path)], check=True)
    frames.append((path, time, label))
for page in range((len(frames) + 8) // 9):
    sheet = Image.new('RGB', (1920, 1170), '#15211f')
    draw = ImageDraw.Draw(sheet)
    for index, (path, time, label) in enumerate(frames[page * 9:(page + 1) * 9]):
        x, y = (index % 3) * 640, (index // 3) * 390
        draw.text((x + 8, y + 8), f'{time:g}s | {label}', fill='white')
        sheet.paste(Image.open(path).resize((640, 360)), (x, y + 30))
    sheet.save(qa / f'contact-sheet-{page + 1}.jpg', quality=94)
report = {
    'duration_seconds': float(probe['format']['duration']),
    'resolution': [v['width'], v['height']],
    'fps': v['r_frame_rate'], 'video_codec': v['codec_name'], 'audio_codec': a['codec_name'],
    'decode_errors': [], 'review_frames': len(frames),
    'sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
    'bytes': video.stat().st_size,
}
(qa / 'media-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
