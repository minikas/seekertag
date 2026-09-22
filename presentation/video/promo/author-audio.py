"""Original swung instrumental + frozen HyperFrames SFX. No voiceover.

Requires numpy, scipy and soundfile; FFmpeg decodes the bundled source sounds.
"""
from pathlib import Path
import json,subprocess
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

root=Path(__file__).resolve().parent
sr=48000;duration=19.8;size=round(sr*duration);rng=np.random.default_rng(210926)
music=np.zeros((size,2));fx=np.zeros((size,2))
def add(bus,start,wave,pan=0):
    offset=round(start*sr)
    if offset<0: wave=wave[-offset:];offset=0
    n=min(len(wave),size-offset)
    if n<=0:return
    if wave.ndim==1: wave=np.column_stack((wave*np.sqrt((1-pan)/2),wave*np.sqrt((1+pan)/2)))
    bus[offset:offset+n]+=wave[:n]
def time(seconds): return np.arange(round(seconds*sr))/sr
def hz(n):return 440*2**((n-69)/12)
def filter_noise(n,lo,hi):
    data=rng.normal(0,1,n)
    return sosfilt(butter(2,[lo,hi],btype='bandpass',fs=sr,output='sos'),data)
def bass(note,length=.35,velocity=1):
    t=time(length);f=hz(note)
    env=(1-np.exp(-t*190))*np.exp(-t*5)*np.minimum((length-t)/.04,1)
    return velocity*.26*(np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*2*f*t)+.07*np.sin(2*np.pi*3*f*t))*env

def keys(notes,length=1.1):
    t=time(length);out=np.zeros(len(t))
    for note in notes:
        f=hz(note)
        env=(1-np.exp(-t*260))*np.exp(-t*2.7)*np.minimum((length-t)/.12,1)
        out+=(np.sin(2*np.pi*f*t+.45*np.sin(2*np.pi*2*f*t)*np.exp(-t*9))+.1*np.sin(2*np.pi*3*f*t))*env
    return out*.027

chords=[(57,60,64,71),(53,57,60,67),(50,57,60,65),(55,59,62,69)]
for beat in range(33):
    pos=beat*.6
    active=pos>=2.4
    # A short intake of breath before the closing brand lands.
    if 15.65<pos<16.2:continue
    t=time(.30)
    kick=np.sin(2*np.pi*(48*t+29*.037*(1-np.exp(-t/.037))))*np.exp(-t*17)*(1-np.exp(-t*900))*.40
    if beat%2==0 or (active and beat%8==7):add(music,pos,kick)
    if active and beat%2==1:
        t=time(.18);env=np.exp(-t*24)*(1-np.exp(-t*900))
        snare=(filter_noise(len(t),700,11500)*.10+np.sin(2*np.pi*184*t)*.09)*env
        add(music,pos+.005,snare,-.05)
    if active:
        chord=chords[((beat-4)//8)%4]
        for off,note,vel in [(0,chord[0]-12,1),(.40,chord[0],.45)] if beat%2==0 else [(.30,chord[0]-12,.7)]:
            add(music,pos+off+rng.uniform(-.007,.007),bass(note,.30,vel))
        if beat%4 in [0,2]:add(music,pos+.31,keys(chord),(-.2 if beat%4==0 else .2))
        for sub in [0,.32]:
            t=time(.085);hat=filter_noise(len(t),5500,18000)*np.exp(-t*68)*(.042 if sub else .026)
            add(music,pos+sub+rng.uniform(-.006,.006),hat,.35 if sub else -.35)
# Opening chord/closing resolution are composed, not endless held synth pads.
add(music,0,keys((57,60,64),1.0))
add(music,16.2,keys((57,60,64,71),2.2))
add(music,18.0,keys((57,60,64,69),1.8))
t=np.arange(size)/sr
music*= (np.minimum(t/.012,1)*np.minimum((duration-t)/.7,1))[:,None]
# Short reductions around message and send accents make the actions audible.
for event in [4.4,5.4,7.169,10.42,14.55]:
    envelope=1-.30*np.exp(-((t-event)/.15)**2)
    music*=envelope[:,None]
music*=.60/np.max(np.abs(music))
sf.write(root/'assets/music.wav',music,sr,subtype='PCM_16')

sounds=[('sfx-whoosh.mp3',2.35,.20),('sfx-chime.mp3',4.40,.16),('sfx-notification.mp3',5.40,.27),('sfx-click.mp3',7.129,.18),('sfx-click.mp3',10.38,.16),('sfx-chime.mp3',14.55,.25),('sfx-whoosh.mp3',16.0,.16)]
for name,start,gain in sounds:
    result=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'assets'/name),'-f','f32le','-ac','2','-ar',str(sr),'-'])
    wave=np.frombuffer(result,dtype=np.float32).reshape(-1,2).copy()
    wave*=gain/max(.001,np.max(np.abs(wave)))
    add(fx,start,wave)
fx*=np.minimum((duration-t)/.3,1)[:,None]
sf.write(root/'assets/sound-design.wav',fx,sr,subtype='PCM_16')
assert np.max(np.abs(music+fx))<.95
(root/'audio-timing.json').write_text(json.dumps({'duration':duration,'bpm':100,'voiceover':False,'seed':210926,'sounds':[{'file':f,'start':t,'gain':v} for f,t,v in sounds]},indent=2)+'\n')
print('Original 100 BPM swung groove, notification/send/reward sound accents; no speech.')
