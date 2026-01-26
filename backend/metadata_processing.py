"""音频文件元数据处理模块 - 使用mutagen库

支持MP3和FLAC格式的音频文件元数据读取、修改和删除操作。
可以处理标题、艺术家、歌词和封面等元数据信息。
"""

import os
from typing import Optional, Tuple

from mutagen.flac import FLAC
from mutagen.id3 import ID3, TIT2, TPE1, USLT, APIC
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.easyid3 import EasyID3


class AudioProcessing:
    """音频文件元数据处理类

    使用mutagen库进行音频元数据处理。
    支持MP3、FLAC、M4A格式。
    """

    def __init__(
        self,
        audio: Optional[str] = None,
        title: Optional[str] = None,
        artist: Optional[str] = None,
        lyrics: Optional[str] = None,
        cover: Optional[str] = None,
    ) -> None:
        """初始化音频处理器

        Args:
            audio: 音频文件路径
            title: 标题
            artist: 艺术家
            lyrics: 歌词（可以是字符串或歌词文件路径）
            cover: 封面图片路径或bytes数据
        """
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover
        self._cover_data = None  # 存储封面bytes数据

    def __read_file_content(self, file_path: str) -> Optional[bytes]:
        """读取文件内容

        Args:
            file_path: 文件路径

        Returns:
            文件内容（bytes）或None
        """
        if not file_path:
            return None

        try:
            with open(file_path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None
        except Exception as e:
            print(f"警告: 读取文件失败 {file_path} - {e}")
            return None

    def __read_lyrics_content(self) -> Optional[str]:
        """读取歌词内容

        Returns:
            歌词字符串或None
        """
        if not self.lyrics:
            return None

        # 如果是字符串且不是文件路径，直接返回
        if isinstance(self.lyrics, str):
            # 检查是否是文件路径
            if os.path.isfile(self.lyrics):
                try:
                    with open(self.lyrics, "r", encoding="utf-8") as f:
                        return f.read()
                except Exception as e:
                    print(f"警告: 读取歌词文件失败 {self.lyrics} - {e}")
                    return None
            # 否则当作纯文本歌词处理
            return self.lyrics

        return None

    def __get_file_type(self) -> Optional[str]:
        """获取音频文件类型

        Returns:
            文件类型字符串: 'flac', 'mp3', 'm4a' 或 None
        """
        if not self.audio or not os.path.isfile(self.audio):
            return None

        _, ext = os.path.splitext(self.audio)
        return ext.lower().replace('.', '')

    def __read_text_metadata(self) -> dict:
        """读取文本元数据（标题、艺术家、歌词）

        Returns:
            dict: 包含title, artist, lyrics的字典
        """
        metadata = {"title": None, "artist": None, "lyrics": None}
        file_type = self.__get_file_type()

        if file_type == "flac":
            audio = FLAC(self.audio)
            metadata["title"] = audio.get("title", [None])[0]
            metadata["artist"] = audio.get("artist", [None])[0]
            metadata["lyrics"] = audio.get("lyrics", [None])[0]

        elif file_type == "mp3":
            try:
                audio = EasyID3(self.audio)
                metadata["title"] = audio.get("title", [None])[0]
                metadata["artist"] = audio.get("artist", [None])[0]
                metadata["lyrics"] = audio.get("lyrics", [None])[0]
            except Exception:
                # 如果EasyID3失败，尝试使用ID3
                try:
                    audio = ID3(self.audio)
                    title = audio.get("TIT2")
                    if title:
                        metadata["title"] = str(title[0])
                    artist = audio.get("TPE1")
                    if artist:
                        metadata["artist"] = str(artist[0])
                    # 歌词在USLT帧中
                    uslt = audio.get("USLT:")
                    if uslt:
                        metadata["lyrics"] = str(uslt[0].text)
                except Exception:
                    pass

        elif file_type == "m4a":
            try:
                audio = MP4(self.audio)
                metadata["title"] = audio.get("\xa9nam", [None])[0]
                metadata["artist"] = audio.get("\xa9ART", [None])[0]
                metadata["lyrics"] = audio.get("\xa9lyr", [None])[0]
            except Exception:
                pass

        return metadata

    def __write_text_metadata(self, title: Optional[str] = None,
                              artist: Optional[str] = None,
                              lyrics: Optional[str] = None) -> bool:
        """写入文本元数据

        Args:
            title: 标题
            artist: 艺术家
            lyrics: 歌词

        Returns:
            bool: 成功返回True，失败返回False
        """
        file_type = self.__get_file_type()

        try:
            if file_type == "flac":
                audio = FLAC(self.audio)
                if title is not None:
                    audio["title"] = title
                if artist is not None:
                    audio["artist"] = artist
                if lyrics is not None:
                    audio["lyrics"] = lyrics
                audio.save()
                return True

            elif file_type == "mp3":
                try:
                    audio = EasyID3(self.audio)
                except Exception:
                    audio = EasyID3()

                if title is not None:
                    audio["title"] = title
                if artist is not None:
                    audio["artist"] = artist
                if lyrics is not None:
                    audio["lyrics"] = lyrics
                audio.save(self.audio)
                return True

            elif file_type == "m4a":
                audio = MP4(self.audio)
                if title is not None:
                    audio["\xa9nam"] = title
                if artist is not None:
                    audio["\xa9ART"] = artist
                if lyrics is not None:
                    audio["\xa9lyr"] = lyrics
                audio.save()
                return True

            return False

        except Exception as e:
            print(f"警告: 写入文本元数据失败 - {e}")
            return False

    def __write_cover(self, cover_data: bytes) -> bool:
        """使用mutagen写入封面图片

        Args:
            cover_data: 封面图片的二进制数据

        Returns:
            bool: 写入成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        file_type = self.__get_file_type()
        if not file_type:
            return False

        try:
            if file_type == "flac":
                # 处理FLAC文件
                audio = FLAC(self.audio)
                # 清除现有封面
                audio.clear_pictures()
                # 添加新封面
                from mutagen.flac import Picture
                picture = Picture()
                picture.data = cover_data
                picture.mime = "image/jpeg"
                picture.type = 3  # Cover front
                audio.add_picture(picture)
                audio.save()
                return True

            elif file_type == "mp3":
                # 处理MP3文件
                try:
                    audio = ID3(self.audio)
                except Exception:
                    audio = ID3()

                # 删除现有APIC帧
                audio.delall("APIC")

                # 添加新封面
                apic = APIC(
                    encoding=3,
                    mime="image/jpeg",
                    type=3,
                    desc="Cover",
                    data=cover_data
                )
                audio.add(apic)
                audio.save()
                return True

            elif file_type == "m4a":
                # 处理M4A文件
                audio = MP4(self.audio)
                audio["covr"] = [cover_data]
                audio.save()
                return True

            else:
                print(f"警告: 不支持的文件类型 {file_type}，无法写入封面")
                return False

        except Exception as e:
            print(f"警告: 写入封面失败 - {e}")
            return False

    def __check_cover(self) -> bool:
        """检查封面是否存在

        Returns:
            bool: 封面存在返回True，否则返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        file_type = self.__get_file_type()
        if not file_type:
            return False

        try:
            if file_type == "flac":
                audio = FLAC(self.audio)
                return bool(audio.pictures)

            elif file_type == "mp3":
                try:
                    audio = ID3(self.audio)
                except Exception:
                    return False
                return bool(audio.getall("APIC"))

            elif file_type == "m4a":
                audio = MP4(self.audio)
                return bool("covr" in audio)

            return False

        except Exception:
            return False

    def __delete_cover(self) -> bool:
        """删除封面

        Returns:
            bool: 删除成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        file_type = self.__get_file_type()
        if not file_type:
            return False

        try:
            if file_type == "flac":
                audio = FLAC(self.audio)
                audio.clear_pictures()
                audio.save()
                return True

            elif file_type == "mp3":
                try:
                    audio = ID3(self.audio)
                except Exception:
                    return True  # 没有ID3标签，不算失败
                audio.delall("APIC")
                audio.save()
                return True

            elif file_type == "m4a":
                audio = MP4(self.audio)
                if "covr" in audio:
                    del audio["covr"]
                audio.save()
                return True

            return False

        except Exception as e:
            print(f"警告: 删除封面失败 - {e}")
            return False

    def metadata_check(self) -> Tuple[bool, bool, bool, bool]:
        """检查音频文件的元数据是否存在

        Returns:
            Tuple[bool, bool, bool, bool]: (标题是否存在, 艺术家是否存在, 歌词是否存在, 封面是否存在)
        """
        if not self.audio or not os.path.isfile(self.audio):
            print("错误: 音频文件不存在")
            return False, False, False, False

        try:
            metadata = self.__read_text_metadata()
            title_check = bool(metadata.get("title"))
            artist_check = bool(metadata.get("artist"))
            lyrics_check = bool(metadata.get("lyrics"))
            cover_check = self.__check_cover()

            return title_check, artist_check, lyrics_check, cover_check

        except Exception as e:
            print(f"错误: 元数据检查失败 - {e}")
            return False, False, False, False

    def metadata_processing(self) -> bool:
        """处理音频文件元数据（只填充缺失的字段）

        Returns:
            bool: 处理成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            print("错误: 音频文件不存在")
            return False

        try:
            # 读取现有元数据
            existing_metadata = self.__read_text_metadata()

            # 准备要写入的元数据（只填充缺失的字段）
            title_to_write = None if existing_metadata.get("title") else (self.title or None)
            artist_to_write = None if existing_metadata.get("artist") else (self.artist or None)
            lyrics_to_write = None

            if not existing_metadata.get("lyrics"):
                lyrics_content = self.__read_lyrics_content()
                lyrics_to_write = lyrics_content if lyrics_content else None

            # 写入文本元数据
            if any([title_to_write, artist_to_write, lyrics_to_write]):
                self.__write_text_metadata(
                    title=title_to_write,
                    artist=artist_to_write,
                    lyrics=lyrics_to_write
                )

            # 处理封面
            if self.cover and not self.__check_cover():
                # 如果cover是bytes类型，直接使用；否则读取文件
                if isinstance(self.cover, bytes):
                    cover_data = self.cover
                else:
                    cover_data = self.__read_file_content(self.cover)

                if cover_data:
                    self.__write_cover(cover_data)

            return True

        except Exception as e:
            print(f"错误: 元数据处理失败 - {e}")
            return False

    def metadata_update(self, overwrite: bool = False) -> bool:
        """更新音频文件元数据（可选择覆盖现有字段）

        Args:
            overwrite: 是否覆盖现有元数据字段

        Returns:
            bool: 处理成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            print("错误: 音频文件不存在")
            return False

        try:
            # 读取现有元数据
            existing_metadata = self.__read_text_metadata()

            # 准备要写入的元数据
            title_to_write = None
            artist_to_write = None
            lyrics_to_write = None

            if overwrite or not existing_metadata.get("title"):
                title_to_write = self.title or existing_metadata.get("title")

            if overwrite or not existing_metadata.get("artist"):
                artist_to_write = self.artist or existing_metadata.get("artist")

            if overwrite or not existing_metadata.get("lyrics"):
                lyrics_content = self.__read_lyrics_content()
                if lyrics_content:
                    lyrics_to_write = lyrics_content

            # 写入文本元数据
            if any([title_to_write, artist_to_write, lyrics_to_write]):
                self.__write_text_metadata(
                    title=title_to_write,
                    artist=artist_to_write,
                    lyrics=lyrics_to_write
                )

            # 处理封面
            if self.cover and (overwrite or not self.__check_cover()):
                # 如果cover是bytes类型，直接使用；否则读取文件
                if isinstance(self.cover, bytes):
                    cover_data = self.cover
                else:
                    cover_data = self.__read_file_content(self.cover)

                if cover_data:
                    self.__write_cover(cover_data)

            return True

        except Exception as e:
            print(f"错误: 元数据更新失败 - {e}")
            return False

    def metadata_delete(self) -> bool:
        """删除音频文件的所有元数据

        Returns:
            bool: 删除成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            print("错误: 音频文件不存在")
            return False

        try:
            # 删除封面
            self.__delete_cover()

            # 删除文本元数据
            self.__write_text_metadata(title="", artist="", lyrics="")

            return True

        except Exception as e:
            print(f"错误: 删除元数据失败 - {e}")
            return False

    def get_metadata_dict(self) -> dict:
        """获取音频文件的所有元数据

        Returns:
            dict: 包含所有元数据的字典
        """
        if not self.audio or not os.path.isfile(self.audio):
            return {}

        try:
            metadata = self.__read_text_metadata()
            return {k: v for k, v in metadata.items() if v is not None}

        except Exception as e:
            print(f"错误: 获取元数据失败 - {e}")
            return {}
