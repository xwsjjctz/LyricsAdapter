from mutagen import flac, id3, File
import os

class AudioProcessing():

    def __init__(self, audio=None, title=None, artist=None, lyrics=None, cover=None) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover
        self.audio_format = self.__get_audio_format()

    def __file_type_check(self, file):
        if file is None:
            return None
        if os.path.isfile(file):
            with open(file, 'r') as f:
                file_stream = f.read()
            return file_stream
        else:
            return file

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
            self.__modify_mp3_metadata()
        audio["TIT2"] = id3.TIT2(encoding=3, text=self.title) if audio.get("TIT2") is None and self.title is not None else audio["TIT2"]
        audio["TPE1"] = id3.TPE1(encoding=3, text=self.artist) if audio.get("TPE1") is None and self.artist is not None else audio['TPE1']
        if self.__file_type_check(self.lyrics) is not None:
            audio.add(id3.TXXX(encoding=3, desc="Lyrics", text=self.__file_type_check(self.lyrics))) if audio.get("TXXX") is None else audio['TXXX']
        if not audio.getall("APIC") and self.cover is not None:
            audio["APIC"] = id3.APIC(encoding=3, mime='image/jpeg', type=3, desc=u'Cover', data=self.__file_type_check(self.cover))
        return audio.save()

    def __modify_flac_metadata(self):
        try:
            audio = flac.FLAC(self.audio)
        except:
            audio = flac.FLAC()
            self.__modify_flac_metadata()
        audio["TITLE"] = self.title if audio.get("TITLE") is None and self.title is not None else audio["TITLE"]
        audio["ARTIST"] = self.artist if audio.get("ARTIST") is None and self.title is not None else audio["ARTIST"]
        if self.__file_type_check(self.lyrics) is not None:
            audio["LYRICS"] = self.__file_type_check(self.lyrics) if audio.get("LYRICS") is None else audio["LYRICS"]
        existing_covers = audio.pictures
        if not existing_covers and self.cover is not None:
            image = flac.Picture()
            image.data = self.__file_type_check(self.cover)
            image.type = 3
            image.mime = u"image/jpeg"
            image.width = 500
            image.height = 500
            audio.add_picture(image)
        return audio.save()

    def metadata_processing(self):
        if self.audio_format == "audio/mp3":
            return self.__modify_mp3_metadata()
        elif self.audio_format == "audio/flac":
            return self.__modify_flac_metadata()
        else:
            raise "不支持的音频格式或文件输入路径有误"
        
    def __check_flac_metadata(self):
        try:
            audio = flac.FLAC(self.audio)
        except:
            audio = flac.FLAC()
            # self.__modify_flac_metadata()
        title_check = audio.get("TITLE")
        artist_check = audio.get("ARTIST")
        lyrics_check = audio.get("LYRICS")
        cover_check = audio.pictures
        return bool(title_check), bool(artist_check), bool(lyrics_check), bool(cover_check)
    
    def __check_mp3_metadata(self):
        try:
            audio = id3.ID3(self.audio)
        except:
            audio = id3.ID3()
            # self.__modify_mp3_metadata()
        title_check = audio.get("TIT2")
        artist_check = audio.get("TPE1")
        lyrics_check = audio.get("TXXX")
        cover_check = audio.getall("APIC")
        return bool(title_check), bool(artist_check), bool(lyrics_check), bool(cover_check)
    
    def metadata_check(self):
        if self.audio_format == "audio/mp3":
            return self.__check_mp3_metadata()
        elif self.audio_format == "audio/flac":
            return self.__check_flac_metadata()
        else:
            raise "不支持的音频格式或文件输入路径有误"
        
    def metadata_delete(self):
        if self.audio_format == "audio/mp3":
            audio = id3.ID3(self.audio)
            audio.delete()
            return audio.save()
        elif self.audio_format == "audio/flac":
            audio = flac.FLAC(self.audio)
            audio.delete()
            audio.clear_pictures()
            return audio.save()
        else:
            raise "不支持的音频格式或文件输入路径有误"
