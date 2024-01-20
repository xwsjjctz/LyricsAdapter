from mutagen import flac, id3, File

class AudioProcessing():

    def __init__(self, audio, title, artist, lyrics, cover) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover
        self.audio_format = self.__get_audio_format()

    def __get_audio_format(self):
        try:
            audio = File(self.audio, easy=True)
            audio_format = audio.mime[0] if hasattr(audio, 'mime') else None
            return audio_format
        except Exception as e:
            print(f"Error: {e}")
            return None
        
    def __modify_mp3_metadata(self):
        try:
            audio = id3.ID3(self.audio)
        except:
            audio = id3.ID3()
        audio["TIT2"] = id3.TIT2(encoding=3, text=self.title) if audio.get("TIT2") is None else audio["TIT2"]
        audio["TPE1"] = id3.TPE1(encoding=3, text=self.artist) if audio.get("TPE1") is None else audio['TPE1']
        if self.lyrics is not None:
            with open(self.lyrics, 'r') as f:
                lyrics = f.read()
            audio.add(id3.TXXX(encoding=3, desc="Lyrics", text=lyrics)) if audio.get("TXXX") is None else audio['TXXX']
        if not audio.getall("APIC") and self.cover is not None:
            with open(self.cover, "rb") as f:
                cover_data = f.read()
            audio["APIC"] = id3.APIC(encoding=3, mime='image/jpeg', type=3, desc=u'Cover', data=cover_data)
        return audio.save()

    def __modify_flac_metadata(self):
        try:
            audio = flac.FLAC(self.audio)
        except:
            audio = flac.FLAC()
        audio["TITLE"] = self.title if audio.get("TITLE") is None else audio["TITLE"]
        audio["ARTIST"] = self.artist if audio.get("ARTIST") is None else audio["ARTIST"]
        if self.lyrics is not None:
            with open(self.lyrics, 'r') as f:
                    lrc = f.read()
            audio["LYRICS"] = lrc if audio.get("LYRICS") is None else audio["LYRICS"]
        existing_covers = audio.pictures
        if not existing_covers and self.cover is not None:
            image = flac.Picture()
            with open(self.cover, "rb") as f:
                image.data = f.read()
            image.type = 3
            image.mime = u"image/jpeg"
            image.width = 500
            image.height = 500
            audio.add_picture(image)
        return audio.save()

    def metadata_processing(self):
        if self.audio_format == "audio/mp3":
            self.__modify_mp3_metadata()
        elif self.audio_format == "audio/flac":
            self.__modify_flac_metadata()
        else:
            raise "不支持的音频格式或文件输入路径有误"
        