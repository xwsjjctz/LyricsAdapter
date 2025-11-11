import os
from typing import Optional, Tuple

from mutagen import File, flac, id3


class AudioProcessing:
    """音频文件元数据处理类

    支持MP3和FLAC格式的音频文件元数据读取、修改和删除操作。
    可以处理标题、艺术家、歌词和封面等元数据信息。
    """

    def __init__(
        self,
        audio: Optional[str] = None,
        title: Optional[str] = None,
        artist: Optional[str] = None,
        lyrics: Optional[str] = None,
        cover: Optional[str] = None,
    ) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover
        self.audio_format = self.__get_audio_format()

    def __file_type_check(self, file):
        """改进的文件类型检查方法，支持二进制文件"""
        if file is None:
            return None

        if not os.path.isfile(file):
            return file  # 如果不是文件路径，直接返回内容

        try:
            # 根据文件扩展名决定读取方式
            if file.lower().endswith((".txt", ".lrc", ".srt")):
                # 文本文件使用UTF-8编码读取
                with open(file, "r", encoding="utf-8") as f:
                    return f.read()
            else:
                # 二进制文件（如图片）使用二进制模式读取
                with open(file, "rb") as f:
                    return f.read()
        except Exception as e:
            print(f"警告: 读取文件失败 {file} - {e}")
            return None

    def __get_audio_format(self) -> Optional[str]:
        """获取音频文件格式"""
        if not self.audio:
            return None

        try:
            audio = File(self.audio, easy=True)
            audio_format = audio.mime[0] if hasattr(audio, "mime") else None
            return audio_format
        except Exception as e:
            print(f"错误: 无法识别音频格式 - {e}")
            return None

    def __modify_mp3_metadata(self):
        """优化后的MP3元数据修改方法"""
        try:
            # 尝试加载现有的ID3标签
            audio = id3.ID3(self.audio)
        except Exception as e:
            # 如果文件不存在或没有ID3标签，创建新的ID3对象
            print(f"警告: 无法加载ID3标签 - {e}")
            audio = id3.ID3()

        # 只在需要时更新各个字段
        if self.title is not None and not audio.get("TIT2"):
            audio["TIT2"] = id3.TIT2(encoding=3, text=self.title)

        if self.artist is not None and not audio.get("TPE1"):
            audio["TPE1"] = id3.TPE1(encoding=3, text=self.artist)

        # 处理歌词
        lyrics_content = self.__file_type_check(self.lyrics)
        if lyrics_content is not None and not audio.get("TXXX"):
            audio.add(id3.TXXX(encoding=3, desc="Lyrics", text=lyrics_content))

        # 处理封面
        if self.cover is not None and not audio.getall("APIC"):
            cover_data = self.__file_type_check(self.cover)
            if cover_data:
                audio["APIC"] = id3.APIC(
                    encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_data
                )

        try:
            return audio.save()
        except Exception as e:
            print(f"错误: 保存MP3元数据失败 - {e}")
            return False

    def __modify_flac_metadata(self):
        """优化后的FLAC元数据修改方法"""
        try:
            # 尝试加载现有的FLAC文件
            audio = flac.FLAC(self.audio)
        except Exception as e:
            # 如果文件不存在或无法加载，创建新的FLAC对象
            print(f"警告: 无法加载FLAC文件 - {e}")
            audio = flac.FLAC()

        # 只在需要时更新各个字段
        if self.title is not None and not audio.get("TITLE"):
            audio["TITLE"] = self.title

        if self.artist is not None and not audio.get("ARTIST"):
            audio["ARTIST"] = self.artist

        # 处理歌词
        lyrics_content = self.__file_type_check(self.lyrics)
        if lyrics_content is not None and not audio.get("LYRICS"):
            audio["LYRICS"] = lyrics_content

        # 处理封面
        existing_covers = audio.pictures
        if not existing_covers and self.cover is not None:
            cover_data = self.__file_type_check(self.cover)
            if cover_data:
                try:
                    image = flac.Picture()
                    image.data = cover_data
                    image.type = 3  # 封面图片
                    image.mime = "image/jpeg"
                    image.width = 500
                    image.height = 500
                    audio.add_picture(image)
                except Exception as e:
                    print(f"警告: 添加封面图片失败 - {e}")

        try:
            return audio.save()
        except Exception as e:
            print(f"错误: 保存FLAC元数据失败 - {e}")
            return False

    def metadata_processing(self) -> bool:
        """统一的元数据处理入口方法

        Returns:
            bool: 处理成功返回True，失败返回False
        """
        if not self.audio:
            print("错误: 未指定音频文件")
            return False

        if not self.audio_format:
            print("错误: 无法识别的音频格式")
            return False

        try:
            if self.audio_format == "audio/mp3":
                return self.__modify_mp3_metadata()
            elif self.audio_format == "audio/flac":
                return self.__modify_flac_metadata()
            else:
                print(f"错误: 不支持的音频格式 - {self.audio_format}")
                return False
        except Exception as e:
            print(f"错误: 元数据处理失败 - {e}")
            return False

    def __check_flac_metadata(self):
        """改进的FLAC元数据检查方法"""
        try:
            audio = flac.FLAC(self.audio)
        except Exception as e:
            print(f"警告: 无法加载FLAC文件进行元数据检查 - {e}")
            return False, False, False, False

        title_check = bool(audio.get("TITLE"))
        artist_check = bool(audio.get("ARTIST"))
        lyrics_check = bool(audio.get("LYRICS"))
        cover_check = bool(audio.pictures)

        return title_check, artist_check, lyrics_check, cover_check

    def __check_mp3_metadata(self):
        """改进的MP3元数据检查方法"""
        try:
            audio = id3.ID3(self.audio)
        except Exception as e:
            print(f"警告: 无法加载MP3文件进行元数据检查 - {e}")
            return False, False, False, False

        title_check = bool(audio.get("TIT2"))
        artist_check = bool(audio.get("TPE1"))
        lyrics_check = bool(audio.get("TXXX"))
        cover_check = bool(audio.getall("APIC"))

        return title_check, artist_check, lyrics_check, cover_check

    def metadata_check(self) -> Tuple[bool, bool, bool, bool]:
        """统一的元数据检查入口方法

        Returns:
            Tuple[bool, bool, bool, bool]: (标题是否存在, 艺术家是否存在, 歌词是否存在, 封面是否存在)
        """
        if not self.audio:
            print("错误: 未指定音频文件")
            return False, False, False, False

        if not self.audio_format:
            print("错误: 无法识别的音频格式")
            return False, False, False, False

        try:
            if self.audio_format == "audio/mp3":
                return self.__check_mp3_metadata()
            elif self.audio_format == "audio/flac":
                return self.__check_flac_metadata()
            else:
                print(f"错误: 不支持的音频格式 - {self.audio_format}")
                return False, False, False, False
        except Exception as e:
            print(f"错误: 元数据检查失败 - {e}")
            return False, False, False, False

    def metadata_delete(self) -> bool:
        """改进的元数据删除方法

        Returns:
            bool: 删除成功返回True，失败返回False
        """
        if not self.audio:
            print("错误: 未指定音频文件")
            return False

        if not self.audio_format:
            print("错误: 无法识别的音频格式")
            return False

        try:
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
                print(f"错误: 不支持的音频格式 - {self.audio_format}")
                return False
        except Exception as e:
            print(f"错误: 删除元数据失败 - {e}")
            return False
