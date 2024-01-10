import os
from mutagen.flac import FLAC
from ffmpy import FFmpeg

class AudioProcessing():

    def __init__(self, audio, title, artist, lyrics, cover) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover

    def metadata_processing(self):
        temp = f"cover_{self.audio}"
        ff = FFmpeg(
            inputs={self.audio: None, 
                    self.cover: None}, 
            outputs={temp: [
                '-map', '0:a', '-map', '1', '-codec', 'copy', 
                '-metadata:s:v', 'title=Album cover', 
                '-metadata:s:v', 'comment=Cover (front)', 
                '-disposition:v', 'attached_pic', 
                '-v', 'quiet', '-y']})
        ff.run()
        file = FLAC(temp)
        file["TITLE"] = self.title
        file["ARTIST"] = self.artist
        with open(self.lyrics, 'r') as f:
            lrc = f.read()
            file["LYRICS"] = lrc
            file.save()
        os.remove(self.audio)
        os.rename(temp, self.audio)