import time
import base64
import requests
import json
import random
import re
import hashlib
import string


class QQMusicMetadata:
    def __init__(self):
        self._headers = {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
            'Referer': 'https://y.qq.com/',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_3_1 like Mac OS X; zh-CN) AppleWebKit/537.51.1 ('
                          'KHTML, like Gecko) Mobile/17D50 UCBrowser/12.8.2.1268 Mobile AliApp(TUnionSDK/0.1.20.3) '
        }
        self._cookies = {}

    def set_cookie(self, cookie):  # 网页Cookie转换到Python字典格式
        list_ret = {}
        cookie_list = cookie.split('; ')  # 分隔符
        for i in range(len(cookie_list)):
            list_1 = cookie_list[i].split('=')  # 分割等于后面的值
            list_ret[list_1[0]] = list_1[1]  # 加入字典
            if len(list_1) == 3:
                list_ret[list_1[0]] = list_1[1] + '=' + list_1[2]
        return list_ret

    def get_sign(self, data):  # QQMusic_Sign算法
        k1 = {"0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "A": 10, "B": 11, "C": 12,
              "D": 13, "E": 14, "F": 15}
        l1 = [212, 45, 80, 68, 195, 163, 163, 203, 157, 220, 254, 91, 204, 79, 104, 6]
        t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        text = json.dumps(data, separators=(',', ':'))
        md5 = hashlib.md5(text.encode()).hexdigest().upper()
        t1 = ''.join([md5[i] for i in [21, 4, 9, 26, 16, 20, 27, 30]])
        t3 = ''.join([md5[i] for i in [18, 11, 3, 2, 1, 7, 6, 25]])

        ls2 = []
        for i in range(16):
            x1 = k1[md5[i * 2]]
            x2 = k1[md5[i * 2 + 1]]
            x3 = ((x1 * 16) ^ x2) ^ l1[i]
            ls2.append(x3)
        ls3 = []
        for i in range(6):
            if i == 5:
                ls3.append(t[ls2[-1] >> 2])
                ls3.append(t[(ls2[-1] & 3) << 4])
            else:
                x4 = ls2[i * 3] >> 2
                x5 = (ls2[i * 3 + 1] >> 4) ^ ((ls2[i * 3] & 3) << 4)
                x6 = (ls2[i * 3 + 2] >> 6) ^ ((ls2[i * 3 + 1] & 15) << 2)
                x7 = 63 & ls2[i * 3 + 2]
                ls3.extend(t[x4] + t[x5] + t[x6] + t[x7])

        t2 = ''.join(ls3).replace('[\\/+]', '')
        sign = 'zzb' + t1 + t2 + t3
        return sign.lower().replace('+', '').replace('/', '').replace('=', '')

    def get_music_url(self, music_mid):  # 通过Mid获取音乐播放URL
        uin = ''.join(random.sample('1234567890', 10))  # UIN基本不校验,长度10就行,如果请求正常这是你的QQ号
        data = {
            "req": {
                "module": "CDN.SrfCdnDispatchServer",
                "method": "GetCdnDispatch",
                "param": {
                    "guid": "1535153710",
                    "calltype": 0,
                    "userip": ""
                }
            },
            "req_0": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": {
                    "guid": "1535153710",
                    "songmid": [music_mid],
                    "songtype": [0],
                    "uin": uin,
                    "loginflag": 1,
                    "platform": "20",
                }
            },
            "comm": {
                "uin": uin,
                "format": "json",
                "ct": 24,
                "cv": 0
            }
        }
        ret = json.loads(requests.get('https://u.y.qq.com/cgi-bin/musicu.fcg?data={}'.format(json.dumps(data)),
                                      headers=self._headers, cookies=self._cookies).text)
        if ret['code'] == 500001:  # 如果返回500001表示提交的数据有问题或Cookie过期之类的(解析绿钻歌曲你不是绿钻也有可能给你这个)
            return 'Error'
        return 'https://dl.stream.qqmusic.qq.com/{}'.format(ret['req_0']['data']['midurlinfo'][0]['purl'])

    def get_music_info(self, music_id):  # 通过音乐的ID获取歌曲信息
        uin = ''.join(random.sample('1234567890', 10))
        data = {"comm": {"cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
                         "notice": 0, "platform": "yqq.json", "needNewCode": 1, "uin": uin,
                         "g_tk_new_20200303": 708550273, "g_tk": 708550273},
                "req_1": {"module": "music.trackInfo.UniformRuleCtrl", "method": "CgiGetTrackInfo",
                          "param": {"ids": [music_id], "types": [0]}}}
        ret = json.loads(requests.get(url='https://u.y.qq.com/cgi-bin/musicu.fcg?data={}'.format(json.dumps(data)),
                                      headers=self._headers, cookies=self._cookies).text)
        if ret['code'] == 500001:  # 如果返回500001代表提交的数据有问题
            return 'Error'
        return ret['req_1']['data']['tracks']  # 直接返回QQ音乐服务器返回的结果,和搜索返回的感觉差不多,直接返回tracks数组\

    def get_album_info(self, album_mid):  # 获取专辑信息
        uin = ''.join(random.sample('1234567890', 10))  # 和音乐的那个一样,uin随机10个数字就行
        data = {"comm": {"cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
                         "notice": 0, "platform": "yqq.json", "needNewCode": 1, "uin": uin,
                         "g_tk_new_20200303": 708550273, "g_tk": 708550273},
                "req_1": {"module": "music.musichallAlbum.AlbumInfoServer", "method": "GetAlbumDetail",
                          "param": {"albumMid": album_mid}}}
        resp = json.loads(requests.get(url='https://u.y.qq.com/cgi-bin/musicu.fcg?data={}'.format(json.dumps(data)),
                                       headers=self._headers, cookies=self._cookies).text)
        if resp['code'] == 500001:  # 如果返回500001代表提交的数据有问题
            return {'Error'}
        return resp

    def search_music(self, name, limit=20):  # 搜索歌曲,name歌曲名,limit返回数量
        return requests.get(url='https://shc.y.qq.com/soso/fcgi-bin/search_for_qq_cp?_=1657641526460&g_tk'
                                '=1037878909&uin=1804681355&format=json&inCharset=utf-8&outCharset=utf-8&notice=0'
                                '&platform=h5&needNewCode=1&w={}&zhidaqu=1&catZhida=1&t=0&flag=1&ie=utf-8&sem=1'
                                '&aggr=0&perpage={}&n={}&p=1&remoteplace=txt.mqq.all'.format(name, limit, limit),
                            headers=self._headers).json()['data']['song']['list']

    def search_music_2(self, name, limit=20):  # 搜索歌曲,name歌曲名,limit返回数量
        data = json.dumps(
            {"comm": {"g_tk": 997034911, "uin": ''.join(random.sample(string.digits, 10)), "format": "json",
                      "inCharset": "utf-8",
                      "outCharset": "utf-8", "notice": 0, "platform": "h5", "needNewCode": 1, "ct": 23, "cv": 0},
             "req_0": {"method": "DoSearchForQQMusicDesktop", "module": "music.search.SearchCgiService",
                       "param": {"remoteplace": "txt.mqq.all",
                                 "searchid": "".join(random.sample(string.digits + string.digits, 18)),
                                 "search_type": 0,
                                 "query": name, "page_num": 1, "num_per_page": limit}}},
            ensure_ascii=False).encode('utf-8')
        return requests.post(
            url='https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=DoSearchForQQMusicDesktop&_={}'.format(
                int(round(time.time() * 1000))),
            headers={
                'Accept': '/',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Referer': 'https://y.qq.com/',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_3_1 like Mac OS X; zh-CN) AppleWebKit/537.51.1 ('
                              'KHTML, like Gecko) Mobile/17D50 UCBrowser/12.8.2.1268 Mobile AliApp(TUnionSDK/0.1.20.3) '},
            data=data).json()['req_0']['data']['body']['song']['list']

    def get_playlist_info(self, playlist_id):  # 通过歌单ID获取歌单信息,songList返回的内容和搜索返回的差不多
        return json.loads(str(re.findall('window.__INITIAL_DATA__ =(.*?)</script>',
                                         requests.get(url='https://y.qq.com/n/ryqq/playlist/{}'.format(playlist_id),
                                                      headers=self._headers,
                                                      cookies=self._cookies).text)[0]).replace('undefined',
                                                                                               '"undefined"'))

    def get_playlist_info_num(self, playlist_id, song_num):  # 逐个获取歌单ID内容
        data = {"comm": {"g_tk": 5381, "uin": "", "format": "json", "inCharset": "utf-8", "outCharset": "utf-8",
                         "notice": 0, "platform": "h5", "needNewCode": 1},
                "req_0": {"module": "music.srfDissInfo.aiDissInfo", "method": "uniform_get_Dissinfo",
                          "param": {"disstid": int(playlist_id), "enc_host_uin": "", "tag": 1, "userinfo": 1,
                                    "song_begin": song_num, "song_num": 30}}}
        resp = json.loads(requests.post(
            url='https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=uniform_get_Dissinfo&_={}'.format(
                int(time.time() * 1000)),
            headers=self._headers, cookies=self._cookies, data=json.dumps(data)).text)
        if resp['code'] == 500001:  # 如果返回500001代表提交的数据有问题
            return 'Error'
        return resp['req_0']['data']['songlist']

    def get_recommended_playlist(self):  # 获取QQ音乐推荐歌单,获取内容应该和Cookie有关
        return json.loads(str(re.findall('window.__INITIAL_DATA__ =(.*?)</script>',
                                         requests.get(url='https://y.qq.com/n/ryqq/category',
                                                      headers=self._headers,
                                                      cookies=self._cookies).text)[0]).replace('undefined',
                                                                                               '"undefined"'))

    def get_lyrics(self, mid, translate=False):  # 获取歌曲歌词信息
        resp = requests.get(
            url='https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_={}'
                '&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json'
                '&needNewCode=1&g_tk=5381&songmid={}'.format(
                time.time(), mid),
            headers=self._headers, cookies=self._cookies).json()
        if translate:
            data = resp['trans']
            if data == '':
                data = resp['lyric']
        else:
            data = resp['lyric']
        return base64.b64decode(data).decode('utf-8')

    def get_radio_info(self):  # 获取个性电台信息
        return json.loads(str(re.findall('window.__INITIAL_DATA__ =(.*?)</script>',
                                         requests.get(url='https://y.qq.com/n/ryqq/radio',
                                                      headers=self._headers,
                                                      cookies=self._cookies).text)[0]).replace('undefined',
                                                                                               '"undefined"'))

    def get_toplist_music(self):
        return json.loads(re.compile('firstPageData\\s=(.*?)\n').findall(
            requests.get(url='https://i.y.qq.com/n2/m/share/details/toplist.html?ADTAG=ryqq.toplist&type=0&id=4',
                         headers=self.headers).text)[0])

    def get_mv_url(self, vid):  # 获取MV信息,下载地址
        data = {"comm": {"ct": 6, "cv": 0, "g_tk": 1366999994, "uin": ''.join(random.sample('1234567890', 10)),
                         "format": "json", "platform": "yqq"},
                "mvInfo": {"module": "video.VideoDataServer", "method": "get_video_info_batch",
                           "param": {"vidlist": [vid],
                                     "required": ["vid", "type", "sid", "cover_pic", "duration", "singers",
                                                  "new_switch_str", "video_pay", "hint", "code", "msg", "name", "desc",
                                                  "playcnt", "pubdate", "isfav", "fileid", "filesize", "pay",
                                                  "pay_info", "uploader_headurl", "uploader_nick", "uploader_uin",
                                                  "uploader_encuin"]}},
                "mvUrl": {"module": "music.stream.MvUrlProxy", "method": "GetMvUrls",
                          "param": {"vids": [vid], "request_type": 10003, "addrtype": 3, "format": 264}}}
        return requests.post(url='https://u.y.qq.com/cgi-bin/musicu.fcg', data=json.dumps(data), timeout=1,
                             headers=self._headers).json()

    def get_singer_album_info(self, mid):
        uin = ''.join(random.sample('1234567890', 10))  # 和音乐的那个一样,uin随机10个数字就行
        data = {"req_0": {"module": "music.homepage.HomepageSrv", "method": "GetHomepageTabDetail",
                          "param": {"uin": uin, "singerMid": mid, "tabId": "album", "page": 0,
                                    "pageSize": 10, "order": 0}},
                "comm": {"g_tk": 1666686892, "uin": int(uin), "format": "json", "platform": "h5", "ct": 23}}
        resp = requests.get(url='https://u.y.qq.com/cgi-bin/musicu.fcg?data={}'.format(json.dumps(data)),
                            headers=self._headers, cookies=self._cookies).json()
        if resp['code'] == 500001:  # 如果返回500001代表提交的数据有问题
            return 'Error'
        return resp['req_0']['data']['list']
    

    def get_Toplist_Info(self):
        data = {
            "comm": {
                "cv": 4747474,
                "ct": 24,
                "format": "json",
                "inCharset": "utf-8",
                "outCharset": "utf-8",
                "notice": 0,
                "platform": "yqq.json",
                "needNewCode": 1,
                "uin": 0,
                "g_tk_new_20200303": 5381,
                "g_tk": 5381
            },
            "req_1": {
                "module": "musicToplist.ToplistInfoServer",
                "method": "GetAll",
                "param": {}
            }
        }
        return requests.get(
            url='https://u.y.qq.com/cgi-bin/musics.fcg?_={}&sign={}'.format(int(time.time() * 1000),
                                                                            self.get_sign(data)),
            headers=self._headers, cookies=self._cookies, data=json.dumps(data, separators=(',', ':'))).json()['req_1']

    @property
    def headers(self):
        return self._headers
