import os
import subprocess
from mutagen import flac, mp3, ogg

class AudioProcessing():

    def __init__(self, audio, title, artist, lyrics, cover) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover

    def audio_unlock(self):
        pass

    def metadata_view(self):
        cmd = ['ffprobe', '-i', self.audio, '-hide_banner']
        ff = subprocess.run(cmd, stdout=subprocess.PIPE)

    def metadata_processing(self):
        temp = f"cover_{self.audio}"
        cmd = ['ffmpeg', '-i', self.audio, '-i', self.cover, 
               '-map', '0:a', '-map', '1', '-codec', 'copy', 
               '-metadata:s:v', 'title=Album cover', 
               '-metadata:s:v', 'comment=Cover (front)', 
               '-disposition:v', 'attached_pic', 
               '-v', 'quiet', '-y', temp]
        subprocess.run(cmd, stdout=subprocess.PIPE)
        file = flac.FLAC(temp)
        file["TITLE"] = self.title
        file["ARTIST"] = self.artist
        with open(self.lyrics, 'r') as f:
            lrc = f.read()
            file["LYRICS"] = lrc
            file.save()
        os.remove(self.audio)
        os.rename(temp, self.audio)