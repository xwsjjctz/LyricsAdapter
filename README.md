暂时实现了本地音乐输入后自动为音乐内嵌缺少的元数据，歌词以及封面。
需要在cookie.txt中输入某音乐平台的cookie。
获取音频元数据部分基于`https://github.com/MCQTSS/MCQTSS_QQMusic/blob/main/Main.py`实现，对应utils目录下的qq_music_api.py文件。

加密音频逆向部分基于`https://github.com/nullptr-0/QmcWasm`项目实现。
