from audio_processing import AudioProcessing

music = AudioProcessing(
    audio="阿桑 - 一直很安静.flac", 
    title="叹", 
    artist="兰音Reine", 
    lyrics="阿桑 - 一直很安静.lrc", 
    cover="兰音Reine.jpeg"
    )
music.metadata_processing()