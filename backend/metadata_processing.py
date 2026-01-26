"""音频文件元数据处理模块 - 使用oxidant库

支持MP3和FLAC格式的音频文件元数据读取、修改和删除操作。
可以处理标题、艺术家、歌词和封面等元数据信息。
"""

import json
import os
from base64 import b64encode
from typing import Optional, Tuple

from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3, APIC
from oxidant import AudioFile


class AudioProcessing:
    """音频文件元数据处理类

    使用oxidant库进行高性能的音频元数据处理。
    支持MP3和FLAC格式。
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

    def __write_cover_with_oxidant(self, cover_data: bytes) -> bool:
        """使用oxidant写入封面图片（单独写入cover字段）

        Args:
            cover_data: 封面图片的二进制数据

        Returns:
            bool: 写入成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)

            # oxidant需要单独写入cover，不混合其他字段
            cover_metadata = {
                "cover": {
                    "mime_type": "image/jpeg",
                    "width": 1000,
                    "height": 1000,
                    "depth": 24,
                    "description": "Cover",
                    "data": b64encode(cover_data).decode("ascii"),
                }
            }

            audio_file.set_metadata(json.dumps(cover_metadata, ensure_ascii=False))
            return True

        except Exception as e:
            print(f"警告: 使用oxidant写入封面失败 - {e}")
            return False

    def __write_cover_with_mutagen(self, cover_data: bytes) -> bool:
        """使用mutagen写入封面图片（备用方案）

        Args:
            cover_data: 封面图片的二进制数据

        Returns:
            bool: 写入成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)
            file_type = audio_file.file_type.lower()

            if file_type == "flac":
                # 处理FLAC文件
                audio = FLAC(self.audio)
                # 清除现有封面
                audio.clear_pictures()
                # 添加新封面
                picture = Picture()
                picture.data = cover_data
                picture.mime = "image/jpeg"
                picture.type = 3  # Cover front
                audio.add_picture(picture)
                audio.save()
                return True

            elif file_type in ["id3v2", "id3v1", "mp3"]:
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

            else:
                print(f"警告: 不支持的文件类型 {file_type}，无法写入封面")
                return False

        except Exception as e:
            print(f"警告: 使用mutagen写入封面失败 - {e}")
            return False

    def __check_cover_with_oxidant(self) -> bool:
        """使用oxidant检查封面是否存在

        Returns:
            bool: 封面存在返回True，否则返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)
            metadata_json = audio_file.get_metadata()
            if not metadata_json:
                return False

            metadata = json.loads(metadata_json)
            cover = metadata.get("cover")
            # oxidant的封面是对象格式
            return bool(cover and isinstance(cover, dict) and cover.get("data"))

        except Exception:
            return False

    def __check_cover_with_mutagen(self) -> bool:
        """使用mutagen检查封面是否存在（备用方案）

        Returns:
            bool: 封面存在返回True，否则返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)
            file_type = audio_file.file_type.lower()

            if file_type == "flac":
                audio = FLAC(self.audio)
                return bool(audio.pictures)

            elif file_type in ["id3v2", "id3v1", "mp3"]:
                try:
                    audio = ID3(self.audio)
                except Exception:
                    return False
                return bool(audio.getall("APIC"))

            return False

        except Exception:
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
            audio_file = AudioFile(self.audio)
            metadata_json = audio_file.get_metadata()

            if not metadata_json:
                return False, False, False, False

            metadata = json.loads(metadata_json)

            title_check = bool(metadata.get("title"))
            artist_check = bool(metadata.get("artist"))
            lyrics_check = bool(metadata.get("lyrics"))

            # 使用mutagen检查封面（oxidant不支持封面写入）
            cover_check = self.__check_cover_with_mutagen()

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
            audio_file = AudioFile(self.audio)

            # 获取现有元数据
            existing_metadata_json = audio_file.get_metadata()
            existing_metadata = {}

            if existing_metadata_json:
                try:
                    existing_metadata = json.loads(existing_metadata_json)
                except json.JSONDecodeError:
                    existing_metadata = {}

            # 准备新元数据，只填充缺失的字段
            new_metadata = {}

            # 读取现有值
            if not existing_metadata.get("title"):
                new_metadata["title"] = self.title or ""
            if not existing_metadata.get("artist"):
                new_metadata["artist"] = self.artist or ""
            if not existing_metadata.get("lyrics"):
                lyrics_content = self.__read_lyrics_content()
                if lyrics_content:
                    new_metadata["lyrics"] = lyrics_content

            # 处理封面（支持文件路径或bytes数据）
            if self.cover and not existing_metadata.get("cover"):
                # 如果cover是bytes类型，直接使用；否则读取文件
                if isinstance(self.cover, bytes):
                    cover_data = self.cover
                else:
                    cover_data = self.__read_file_content(self.cover)

                if cover_data:
                    # oxidant需要特定的封面对象格式
                    new_metadata["cover"] = {
                        "mime_type": "image/jpeg",
                        "data": b64encode(cover_data).decode("ascii"),
                        "description": "Cover",
                        # 可选字段（oxidant会自动检测）
                        # "width": 0,
                        # "height": 0,
                        # "depth": 24,
                    }

            # 如果有新元数据需要写入
            cover_data = None
            if "cover" in new_metadata:
                # 提取封面数据，使用mutagen处理
                cover_data = self.__read_file_content(self.cover) if isinstance(self.cover, str) else self.cover
                del new_metadata["cover"]

            # 先写入文本元数据（如果有）
            if new_metadata:
                merged_metadata = {**existing_metadata, **new_metadata}
                merged_metadata_json = json.dumps(merged_metadata, ensure_ascii=False)
                audio_file.set_metadata(merged_metadata_json)

            # 使用mutagen写入封面（oxidant不支持封面写入）
            if cover_data:
                self.__write_cover_with_mutagen(cover_data)

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
            audio_file = AudioFile(self.audio)

            # 获取现有元数据
            existing_metadata_json = audio_file.get_metadata()
            existing_metadata = {}

            if existing_metadata_json:
                try:
                    existing_metadata = json.loads(existing_metadata_json)
                except json.JSONDecodeError:
                    existing_metadata = {}

            # 准备新元数据
            new_metadata = {}

            if overwrite or not existing_metadata.get("title"):
                new_metadata["title"] = self.title or existing_metadata.get("title", "")
            if overwrite or not existing_metadata.get("artist"):
                new_metadata["artist"] = self.artist or existing_metadata.get("artist", "")
            if overwrite or not existing_metadata.get("lyrics"):
                lyrics_content = self.__read_lyrics_content()
                if lyrics_content:
                    new_metadata["lyrics"] = lyrics_content

            # 处理封面（支持文件路径或bytes数据）
            cover_data = None
            if self.cover and (overwrite or not existing_metadata.get("cover")):
                # 如果cover是bytes类型，直接使用；否则读取文件
                if isinstance(self.cover, bytes):
                    cover_data = self.cover
                else:
                    cover_data = self.__read_file_content(self.cover)

            # 合并文本元数据
            if new_metadata:
                merged_metadata = {**existing_metadata, **new_metadata}
                merged_metadata_json = json.dumps(merged_metadata, ensure_ascii=False)
                audio_file.set_metadata(merged_metadata_json)

            # 使用mutagen写入封面（oxidant不支持封面写入）
            if cover_data:
                self.__write_cover_with_mutagen(cover_data)

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
            audio_file = AudioFile(self.audio)

            # 使用mutagen删除封面（oxidant不支持封面操作）
            self.__delete_cover_with_mutagen()

            # 设置空的元数据来删除所有文本元数据
            empty_metadata = json.dumps({
                "title": "",
                "artist": "",
                "album": "",
                "lyrics": "",
                "genre": "",
                "year": "",
                "track": "",
                "comment": ""
            }, ensure_ascii=False)
            audio_file.set_metadata(empty_metadata)
            return True

        except Exception as e:
            print(f"错误: 删除元数据失败 - {e}")
            return False

    def __delete_cover_with_oxidant(self) -> bool:
        """使用oxidant删除封面

        Returns:
            bool: 删除成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)
            # oxidant删除封面需要设置cover为null
            delete_cover_metadata = {"cover": None}
            audio_file.set_metadata(json.dumps(delete_cover_metadata))
            return True

        except Exception as e:
            print(f"警告: 使用oxidant删除封面失败 - {e}")
            return False

    def __delete_cover_with_mutagen(self) -> bool:
        """使用mutagen删除封面

        Returns:
            bool: 删除成功返回True，失败返回False
        """
        if not self.audio or not os.path.isfile(self.audio):
            return False

        try:
            audio_file = AudioFile(self.audio)
            file_type = audio_file.file_type.lower()

            if file_type == "flac":
                audio = FLAC(self.audio)
                audio.clear_pictures()
                audio.save()
                return True

            elif file_type in ["id3v2", "id3v1", "mp3"]:
                try:
                    audio = ID3(self.audio)
                except Exception:
                    return True  # 没有ID3标签，不算失败
                audio.delall("APIC")
                audio.save()
                return True

            return False

        except Exception as e:
            print(f"警告: 使用mutagen删除封面失败 - {e}")
            return False

    def get_metadata_dict(self) -> dict:
        """获取音频文件的所有元数据

        Returns:
            dict: 包含所有元数据的字典
        """
        if not self.audio or not os.path.isfile(self.audio):
            return {}

        try:
            audio_file = AudioFile(self.audio)
            metadata_json = audio_file.get_metadata()

            if metadata_json:
                return json.loads(metadata_json)

            return {}

        except Exception as e:
            print(f"错误: 获取元数据失败 - {e}")
            return {}
