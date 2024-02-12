import requests
import time
import qq_music_api

# 初始化QQ音乐对象
with open("cookie.txt", "r") as f:
        cookie = f.read()
QQM = qq_music_api.QQ_Music()
cookie_str = cookie
QQM._cookies = QQM.set_cookie(cookie_str)

class QQMusic:
    def __init__(self):
        self.base_url = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        self.guid = '10000'
        self.uin = '0'
        self.cookies = {}
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        }
        self.file_config = {
            'm4a': {'s': 'C400', 'e': '.m4a', 'bitrate': 'M4A'},
            '128': {'s': 'M500', 'e': '.mp3', 'bitrate': '128kbps'},
            '320': {'s': 'M800', 'e': '.mp3', 'bitrate': '320kbps'},
            'flac': {'s': 'F000', 'e': '.flac', 'bitrate': 'FLAC'},
        }

    def set_cookies(self, cookie_str):
        cookies = {}
        for cookie in cookie_str.split('; '):
            key, value = cookie.split('=', 1)
            cookies[key] = value
        self.cookies = cookies

    def get_music_url(self, songmid, file_type='128'):
        """
        获取音乐播放URL

        参数:
        songmid: str - 歌曲的MID
        file_type: str - 音质类型，可选参数：'m4a', '128', '320', 'flac'

        返回:
        dict - 包含音乐播放URL和比特率的字典
        """
        if file_type not in self.file_config:
            raise ValueError("Invalid file_type. Choose from 'm4a', '128', '320', 'flac'")

        file_info = self.file_config[file_type]
        file = f"{file_info['s']}{songmid}{songmid}{file_info['e']}"
        print(file)

        req_data = {
            'req_1': {
                'module': 'vkey.GetVkeyServer',
                'method': 'CgiGetVkey',
                'param': {
                    'filename': [file],
                    'guid': self.guid,
                    'songmid': [songmid],
                    'songtype': [0],
                    'uin': self.uin,
                    'loginflag': 1,
                    'platform': '20',
                },
            },
            'loginUin': self.uin,
            'comm': {
                'uin': self.uin,
                'format': 'json',
                'ct': 24,
                'cv': 0,
            },
        }
        print(req_data)
        response = requests.post(self.base_url, json=req_data, cookies=self.cookies, headers=self.headers)
        data = response.json()
        print(data)

        purl = data['req_1']['data']['midurlinfo'][0]['purl']
        if purl == '':
            # VIP
            # return None
            pass

        url = data['req_1']['data']['sip'][0] + purl
        prefix = purl[:4]
        bitrate = next((info['bitrate'] for key, info in self.file_config.items() if info['s'] == prefix), '')

        return {'url': url, 'bitrate': bitrate}

if __name__ == "__main__":
    music = QQMusic()
    print(music.get_music_url('001eZJB14ALyBx', 'flac'))