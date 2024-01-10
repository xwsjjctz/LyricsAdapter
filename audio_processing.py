import os
from mutagen.flac import FLAC

class AudioProcessing():

    def __init__(self, audio, title, artist, lyrics, cover) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover

    def metadata_processing(self):
        temp = f"cover_{self.audio}"
        os.system(f'''ffmpeg -i "{self.audio}" -i "{self.cover}" \
                  -map 0:a -map 1 -codec copy \
                  -metadata:s:v title="Album cover" \
                  -metadata:s:v comment="Cover (front)" \
                  -disposition:v attached_pic "{temp}" -v quiet''')
        file = FLAC(temp)
        file["TITLE"] = self.title
        file["ARTIST"] = self.artist
        file["LYRICS"] = self.lyrics
        file.save()
        os.remove(self.audio)
        os.rename(temp, self.audio)