from utils.qq_music_api import QQ_Music
import requests

class GetAudioResource():

    def __init__(self, cookie, search):
        self.cookie = cookie
        self.search = search

    def audio_search(self):
        qq_music = QQ_Music()
        qq_music._cookies = qq_music.set_cookie(self.cookie)
        list_search = qq_music.search_music(self.search, 10)
        return list_search
    
    def audio_info_get(self, mid):
        qq_music = QQ_Music()
        audio_info = qq_music.get_album_info(mid)
        return audio_info
    
    def audio_lyrics_get(self, mid):
        qq_music = QQ_Music()
        lyrics = qq_music.get_lyrics(mid)
        return lyrics
    
    def audio_cover_get(self, mid):
        try:
            url = f'http://y.qq.com/music/photo_new/T002R800x800M000{mid}.jpg'
            response = requests.get(url)
            response.raise_for_status()
            return response.content
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
            return None