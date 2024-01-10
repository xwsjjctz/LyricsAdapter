import os
import subprocess
import json
from mutagen import flac, mp3, ogg

class AudioProcessing():

    # 音频路径 音频标题（曲名） 歌手以及其他作者 歌词（lrc）文件路径 封面文件路径
    # 暂时先创建了这些变量 用于手动修改音频元数据 未来会从网络上自动获取这些资源
    # 实现元数据修改的自动化 不清楚在创建对象时能否解析csv文件中的每行并赋值
    # 实现批量处理
    def __init__(self, audio, title, artist, lyrics, cover) -> None:
        self.audio = audio
        self.title = title
        self.artist = artist
        self.lyrics = lyrics
        self.cover = cover

    # 某音乐平台加密格式音频文件逆向部分
    def audio_unlock(self):
        pass

    # 使用ffprobe获取音频文件的元数据
    # 并将输出重定向到metadata.json
    # meta["streams"][0]["codec_name"]是音频文件中嵌入的封面
    # meta["format"]["format_name"]是音频格式
    # meta["format"]["tags"]中包含音频的TITLE ARTIST LYRICS等
    def __metadata_view(self):
        cmd = ['ffprobe', '-i', self.audio, '-hide_banner', 
               '-v', 'panic', '-show_streams', '-of', 
               'default=noprint_wrappers=0', '-select_streams', 'v:0', '-show_format', '-print_format', 
               'json', '>', 'metadata.json']
        subprocess.run(cmd, shell=True)
        with open('metadata.json', encoding='utf-8') as f:
            meta = json.load(f)
            streams = meta["streams"]
            format = meta["format"]["format_name"]
            tags = meta["format"]["tags"]
        return streams, format, tags
    
    # 获取音频文件的格式 不同的格式需要用到mutagen库中不同的类
    # 一般只有函数中列举的三种格式 这块使用字典推导式简写 问的AI结果这块跑着报错 只能硬用if判断了
    # file变量是使用的文件名 正常情况是将元数据修改后直接覆盖到源文件也就是self.audio上
    # 但是使用ffmpeg将音乐封面嵌入音频文件后必须新建一个文件 为了解耦只能这样了
    def __get_audio_format(self, file):
        _, format, _ = self.__metadata_view()
        if format == "flac":
            return flac.FLAC(file)
        if format == "mp3":
            return mp3.MP3(file)
        if format == "ogg":
            return ogg.OggFileType(file)
        # return {  
        #     "flac": flac.FLAC(file),
        #     "mp3": mp3.MP3(file),
        #     "ogg": ogg.OggFileType(file)
        # }.get(format)

    # 使用ffmpeg将音乐封面嵌入音频文件 
    # 这里新建了一个temp变量用于存放输出的音频路径
    def __audio_cover_processing(self):
        global temp
        temp = f"cover_{self.audio}"
        cmd = ['ffmpeg', '-i', self.audio, '-i', self.cover, 
               '-map', '0:a', '-map', '1', '-codec', 'copy', 
               '-metadata:s:v', 'title=Album cover', 
               '-metadata:s:v', 'comment=Cover (front)', 
               '-disposition:v', 'attached_pic', 
               '-v', 'quiet', '-y', temp]
        return subprocess.run(cmd, stdout=subprocess.PIPE)
    
    # 这里使用了mutagen库对音频元数据进行编辑
    # tags = {k: v for k, v in (("TITLE", self.title), ("ARTIST", self.artist)) if k not in tags}
    # 这行也是用的字典推导式 若音频文件不存在部分元数据则将输入数据作为元数据进行编辑
    def __audio_tags_processing(self, file):
        _, _, tags = self.__metadata_view()
        getfile = self.__get_audio_format(file)
        # print(getfile)
        tags = {k: v for k, v in (("TITLE", self.title), ("ARTIST", self.artist)) if k not in tags}
        if "LYRICS" not in tags:
            with open(self.lyrics, 'r') as f:
                lrc = f.read()
                getfile["LYRICS"] = lrc
        return getfile.save()

    # 音频文件没有封面则使用__audio_cover_processing()添加封面
    # 添加封面后再修改元数据 传入ffmpeg输出的音频路径
    # 音频存在封面则直接修改音频元数据 传入音频路径
    def metadata_processing(self):
        streams, _, _ = self.__metadata_view()
        if streams is None or "codec_name" not in streams:
            self.__audio_cover_processing()
            self.__audio_tags_processing(file=temp)
            os.remove(self.audio)
            os.rename(temp, self.audio)
        else:
            # print(self.audio)
            self.__audio_tags_processing(file=self.audio)
        