import os
import subprocess
import json
from mutagen import flac, ogg, id3

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
        self.streams, self.format_name, self.tags = self.__metadata_view()

    # 添加对mp3文件元数据修改的支持但未添加当元数据存在是是否修改的判断
    def __mp3_audio_tags_processing(self):
        try:
            audio = id3.ID3(self.audio)
        except:
            audio = id3.ID3()
        with open(self.lyrics, 'r') as f:
            lyrics = f.read()
        audio["TIT2"] = id3.TIT2(encoding=3, text=self.title) if audio.get("TIT2") is None else audio["TIT2"]
        audio["TPE1"] = id3.TPE1(encoding=3, text=self.artist) if audio.get("TPE1") is None else audio['TPE1']
        existing_covers = audio.getall("APIC")
        if not existing_covers:
            audio.add(id3.TXXX(encoding=3, desc="Lyrics", text=lyrics))
            with open(self.cover, "rb") as f:
                cover_data = f.read()
            audio["APIC"] = id3.APIC(encoding=3, mime='image/jpeg', type=3, desc=u'Cover', data=cover_data)
        audio.save()

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
        streams = meta["streams"][0] if meta.get("streams") else None
        format_name = meta["format"]["format_name"] if meta.get("format") else None
        tags = meta["format"]["tags"] if meta.get("format") else None
        return streams, format_name, tags

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
    def __flac_audio_tags_processing(self, file):
        getfile = flac.FLAC(file)
        tags = {k: v for k, v in (("TITLE", self.title), ("ARTIST", self.artist)) if k not in self.tags}
        if "LYRICS" not in tags:
            with open(self.lyrics, 'r') as f:
                lrc = f.read()
            getfile["LYRICS"] = lrc
        return getfile.save()

    # 音频文件没有封面则使用__audio_cover_processing()添加封面
    # 添加封面后再修改元数据 传入ffmpeg输出的音频路径
    # 音频存在封面则直接修改音频元数据 传入音频路径
    def metadata_processing(self):
        if self.format_name == "mp3":
            self.__mp3_audio_tags_processing()
        elif self.format_name == "flac":
            if self.streams is None or "codec_name" not in self.streams:
                self.__audio_cover_processing()
                self.__flac_audio_tags_processing(file=temp)
                os.remove(self.audio)
                os.rename(temp, self.audio)
            else:
                self.__flac_audio_tags_processing(file=self.audio)
        elif self.format_name == "ogg":
            pass
        else:
            raise "未读取到音频格式或文件输入路径有误"
        