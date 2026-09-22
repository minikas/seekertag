"""Inspect the encoded deliverable and extract actual output frames for review."""
from pathlib import Path
import argparse
from fractions import Fraction
import hashlib
import json
import subprocess
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('video', nargs='?', type=Path, default=root / 'renders/seekertag-seeker-demo-en.mp4')
parser.add_argument('--timing', type=Path, default=root / 'edit-timing.json')
parser.add_argument('--qa-dir', type=Path, default=root / 'qa')
args = parser.parse_args()
video = args.video.resolve()
qa = args.qa_dir.resolve()
qa.mkdir(parents=True, exist_ok=True)
timing = json.loads(args.timing.read_text())
expected_duration = timing['duration']
fps = timing.get('fps', 30)
width, height = timing.get('width', 1920), timing.get('height', 1080)
expected_frames = round(expected_duration * fps)
if args.timing.resolve() == (root / 'edit-timing.json').resolve():
    cuts = json.loads((root / 'cuts.json').read_text())
else:
    cuts = [dict(id=s['id'], scene=s['id'], start=0, duration=s['duration']) for s in timing['scenes']]
covered = 0
for scene in sorted(timing['scenes'], key=lambda s: s['start']):
    assert abs(scene['start'] - covered) < 1 / fps, f"Scene gap/overlap at {covered:g}s"
    covered += scene['duration']
assert abs(covered - expected_duration) < 1 / fps
for scene in timing['scenes']:
    intervals = sorted((c['start'], c['start'] + c['duration']) for c in cuts if c['scene'] == scene['id'])
    covered = 0
    for start, end in intervals:
        assert start <= covered + 1 / fps, f"Uncovered footage in {scene['id']} at {covered:g}s"
        covered = max(covered, end)
    assert abs(covered - scene['duration']) < 1 / fps, f"Incomplete footage in {scene['id']}: {covered:g}/{scene['duration']:g}s"
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)
]))
v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
a = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert (v['width'], v['height']) == (width, height)
assert Fraction(v['r_frame_rate']) == fps
assert v['codec_name'] == 'h264' and a['codec_name'] == 'aac'
assert abs(float(probe['format']['duration']) - expected_duration) < 0.1
assert int(v['nb_frames']) == expected_frames and abs(float(v['duration']) - expected_duration) < 0.1
decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], capture_output=True, text=True)
assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr

starts = {s['id']: s['start'] for s in timing['scenes']}
samples = {round(starts[c['scene']] + c['start'] + min(1.5, c['duration'] / 2), 3): c['id'] for c in cuts}
samples[expected_duration - 1 / fps] = 'last-frame'
frames = []
for i, (time, label) in enumerate(sorted(samples.items())):
    path = qa / f'frame-{i:02}-{time:g}s.jpg'
    subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(time), '-i', str(video), '-frames:v', '1', '-vf', 'scale=in_range=tv:out_range=pc,format=yuvj420p', '-color_range', 'pc', '-q:v', '2', '-y', str(path)], check=True)
    frames.append((path, time, label))
for page in range((len(frames) + 8) // 9):
    tw, th = (360, 640) if height > width else (640, 360)
    rows = min(3, (len(frames[page * 9:(page + 1) * 9])+2)//3)
    sheet = Image.new('RGB', (tw * 3, (th + 30) * rows), '#15211f')
    draw = ImageDraw.Draw(sheet)
    for index, (path, time, label) in enumerate(frames[page * 9:(page + 1) * 9]):
        x, y = (index % 3) * tw, (index // 3) * (th + 30)
        draw.text((x + 8, y + 8), f'{time:g}s | {label}', fill='white')
        sheet.paste(Image.open(path).resize((tw, th)), (x, y + 30))
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
