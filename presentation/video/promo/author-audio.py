"""Assemble local Kokoro lines and an original instrumental cue.

Requires numpy and soundfile. Run after generating assets/voice-{1..5}.wav.
The instrumental is procedural original audio; it uses no samples.
"""
from pathlib import Path
import json
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parent
rate = 24000
duration = 19.8
count = round(duration * rate)
voice = np.zeros(count, dtype=np.float64)
starts = [0.25, 4.45, 8.65, 12.8, 16.45]
ends = [4.2, 8.4, 12.6, 16.2, 19.8]
metadata = []

def timestamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

captions = []
for i, (start, end) in enumerate(zip(starts, ends), 1):
    samples, sr = sf.read(root / f'assets/voice-{i}.wav')
    assert sr == rate and samples.ndim == 1
    # Retain natural word attacks/tails; remove only exterior empty padding.
    active = np.flatnonzero(np.abs(samples) > .003)
    samples = samples[max(0, active[0]-round(.07*rate)):min(len(samples), active[-1]+round(.14*rate))]
    assert start + len(samples)/rate < end, f'Voice {i} overruns its scene'
    offset = round(start * rate)
    voice[offset:offset+len(samples)] = samples
    text = (root / f'assets/voice-{i}.txt').read_text().strip()
    metadata.append({'scene':i,'start':start,'end':start+len(samples)/rate,'text':text})
    display = text.replace('Q R', 'QR').replace('N F C', 'NFC').replace('S K R', 'SKR').replace('Seeker Tag', 'SeekerTag')
    captions.append(f'{i}\n{timestamp(start)} --> {timestamp(start+len(samples)/rate)}\n{display}\n')
voice *= .72 / np.max(np.abs(voice))
sf.write(root/'assets/narration.wav', voice, rate, subtype='PCM_16')
(root/'narration-timing.json').write_text(json.dumps(metadata, indent=2)+'\n')
(root/'seekertag-promo-en-vertical.srt').write_text('\n'.join(captions))

# 100 BPM, warm A-minor / F / C / G voicings and a soft rhythmic pulse.
music = np.zeros(count, dtype=np.float64)
rng = np.random.default_rng(9121)
def add(t0, sound):
    offset = round(t0*rate)
    n = min(len(sound), count-offset)
    if n > 0:
        music[offset:offset+n] += sound[:n]

def freq(midi):
    return 440*2**((midi-69)/12)

chords = [(57,60,64,71),(53,57,60,67),(48,55,60,64),(55,59,62,69)]
for beat in range(33):
    t0 = beat*.6
    chord = chords[(beat//8)%4]
    # Low pluck with a short bell overtone; restrained so narration leads.
    t = np.arange(round(1.3*rate))/rate
    f = freq(chord[beat%4]+12)
    env = (1-np.exp(-t*150))*np.exp(-t*4.8)
    pluck = (.11*np.sin(2*np.pi*f*t)+.025*np.sin(2*np.pi*2*f*t))*env
    add(t0, pluck)
    if beat%2 == 0:
        t = np.arange(round(.32*rate))/rate
        phase = 2*np.pi*(49*t+25*.045*(1-np.exp(-t/.045)))
        add(t0, .15*np.sin(phase)*(1-np.exp(-t*500))*np.exp(-t*15))
    if beat%2 == 1:
        t = np.arange(round(.12*rate))/rate
        noise = rng.normal(0, 1, len(t))
        noise = noise-np.roll(noise,1)
        add(t0, .009*noise*np.exp(-t*42))

for bar in range(4):
    t = np.arange(round(5.2*rate))/rate
    env = np.minimum(t/.4, 1)*np.minimum((5.2-t)/.8, 1)
    sound = sum(np.sin(2*np.pi*freq(n)*t) for n in chords[bar])*.022*env
    add(bar*4.8, sound)

fade = np.minimum(np.arange(count)/rate/.15, 1)*np.minimum((duration-np.arange(count)/rate)/1.1, 1)
music *= fade
music *= .34 / np.max(np.abs(music))
sf.write(root/'assets/music.wav', music, rate, subtype='PCM_16')
print(json.dumps({'duration':duration,'voice_peak':float(np.max(np.abs(voice))),'music_peak':float(np.max(np.abs(music))),'lines':metadata}, indent=2))
