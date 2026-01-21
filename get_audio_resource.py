import requests

from utils.qq_music_metadata import QQMusicMetadata
from utils.qq_music_resource import QQMusicResource


class GetAudioResource:
    def __init__(self, cookie, search):
        self.cookie = cookie
        self.search = search

    def audio_search(self):
        qq_music = QQMusicMetadata()
        qq_music._cookies = qq_music.set_cookie(self.cookie)
        list_search = qq_music.search_music(self.search, 20)
        return list_search

    def audio_info_get(self, mid):
        qq_music = QQMusicMetadata()
        audio_info = qq_music.get_album_info(mid)
        return audio_info

    def audio_lyrics_get(self, mid):
        qq_music = QQMusicMetadata()
        lyrics = qq_music.get_lyrics(mid)
        return lyrics

    def audio_cover_get(self, mid):
        try:
            url = f"http://y.qq.com/music/photo_new/T002R800x800M000{mid}.jpg"
            response = requests.get(url)
            response.raise_for_status()
            return response.content
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
            return None

    def audio_get(self, mid, quality):
        music = QQMusicResource()
        music.set_cookies(self.cookie)
        try:
            result = music.get_music_url(mid, quality)
            if isinstance(result, dict) and "url" in result:
                return result["url"]
            else:
                return "Error"
        except Exception as e:
            print(f"Error getting music URL: {e}")
            return "Error"

    def get_song_info(self, mid):
        """
        通过音乐的mid获取音乐信息
        需要获取singer，songname，albummid
        Args:
            mid (str): 音乐的mid
        Returns:
            dict: 包含音乐信息的字典
        """

        qq_music = QQMusicMetadata()
        qq_music._cookies = qq_music.set_cookie(self.cookie)

        try:
            # 直接使用get_music_info API通过mid获取歌曲信息
            tracks = qq_music.get_music_info(mid)

            if tracks and len(tracks) > 0:
                track = tracks[0]
                song_info = {
                    "singer": track.get("singer", [{}])[0].get("name", "Unknown") if track.get("singer") else "Unknown",
                    "songname": track.get("title", "Unknown"),
                    "albummid": track.get("album", {}).get("mid", "")
                }
                return song_info
            else:
                return {
                    "singer": "Unknown",
                    "songname": "Unknown",
                    "albummid": ""
                }

        except Exception as e:
            print(f"Error in get_song_info: {e}")
            import traceback
            traceback.print_exc()
            return {
                "singer": "Unknown",
                "songname": "Unknown",
                "albummid": ""
            }
