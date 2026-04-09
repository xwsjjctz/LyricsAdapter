import { logger } from './logger';

export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'de' | 'fr';

interface Translations {
  [key: string]: {
    zh: string;
    en: string;
    ja: string;
    ko: string;
    de: string;
    fr: string;
  };
}

const translations: Translations = {
  // Sidebar
  'sidebar.library': {
    zh: '音乐库',
    en: 'Library',
    ja: 'ライブラリ',
    ko: '라이브러리',
    de: 'Bibliothek',
    fr: 'Bibliothèque'
  },
  'sidebar.browse': {
    zh: '浏览',
    en: 'Browse',
    ja: 'ブラウズ',
    ko: '찾아보기',
    de: 'Durchsuchen',
    fr: 'Parcourir'
  },
  'sidebar.metadata': {
    zh: '元数据',
    en: 'Metadata',
    ja: 'メタデータ',
    ko: '메타데이터',
    de: 'Metadaten',
    fr: 'Métadonnées'
  },
  'sidebar.importFiles': {
    zh: '导入文件',
    en: 'Import Files',
    ja: 'インポート',
    ko: '파일 가져오기',
    de: 'Dateien importieren',
    fr: 'Importer'
  },
  'sidebar.searchOnline': {
    zh: '在线搜索 (回车)',
    en: 'Search online (Enter)',
    ja: 'オンライン検索 (Enter)',
    ko: '온라인 검색 (Enter)',
    de: 'Online suchen (Enter)',
    fr: 'Rechercher en ligne (Entrée)'
  },
  'sidebar.searchTracks': {
    zh: '搜索曲目 (回车)',
    en: 'Search tracks (Enter)',
    ja: 'トラックを検索 (Enter)',
    ko: '트랙 검색 (Enter)',
    de: 'Titel suchen (Enter)',
    fr: 'Rechercher des titres (Entrée)'
  },
  'sidebar.reloadFiles': {
    zh: '重新加载文件',
    en: 'Reload Files',
    ja: 'ファイルを再読み込み',
    ko: '파일 새로고침',
    de: 'Dateien neu laden',
    fr: 'Recharger les fichiers'
  },
  'sidebar.theme': {
    zh: '主题',
    en: 'Theme',
    ja: 'テーマ',
    ko: '테마',
    de: 'Thema',
    fr: 'Thème'
  },

  // Library View
  'library.title': {
    zh: '音乐库',
    en: 'Library',
    ja: 'ライブラリ',
    ko: '라이브러리',
    de: 'Bibliothek',
    fr: 'Bibliothèque'
  },
  'library.trackCount': {
    zh: '首曲目',
    en: 'Tracks in your collection',
    ja: '曲',
    ko: '곡',
    de: 'Titel in Ihrer Sammlung',
    fr: 'Titres dans votre collection'
  },
  'library.of': {
    zh: '共',
    en: 'of',
    ja: '/',
    ko: '/',
    de: 'von',
    fr: 'sur'
  },
  'library.titleCol': {
    zh: '标题',
    en: 'Title',
    ja: 'タイトル',
    ko: '제목',
    de: 'Titel',
    fr: 'Titre'
  },
  'library.albumCol': {
    zh: '专辑',
    en: 'Album',
    ja: 'アルバム',
    ko: '앨범',
    de: 'Album',
    fr: 'Album'
  },
  'library.timeCol': {
    zh: '时长',
    en: 'Time',
    ja: '時間',
    ko: '시간',
    de: 'Zeit',
    fr: 'Durée'
  },
  'library.actionCol': {
    zh: '操作',
    en: 'Action',
    ja: '操作',
    ko: '작업',
    de: 'Aktion',
    fr: 'Action'
  },
  'library.cancel': {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
    ko: '취소',
    de: 'Abbrechen',
    fr: 'Annuler'
  },
  'library.selectAll': {
    zh: '全选',
    en: 'Select All',
    ja: 'すべて選択',
    ko: '모두 선택',
    de: 'Alle auswählen',
    fr: 'Tout sélectionner'
  },
  'library.deleteSelected': {
    zh: '删除所选',
    en: 'Delete Selected',
    ja: '選択を削除',
    ko: '선택 삭제',
    de: 'Ausgewählte löschen',
    fr: 'Supprimer la sélection'
  },
  'library.editMode': {
    zh: '编辑模式',
    en: 'Edit Mode',
    ja: '編集モード',
    ko: '편집 모드',
    de: 'Bearbeitungsmodus',
    fr: 'Mode édition'
  },
  'library.completed': {
    zh: '完成',
    en: 'Completed',
    ja: '完了',
    ko: '완료',
    de: 'Abgeschlossen',
    fr: 'Terminé'
  },
  'library.noMatchingTracks': {
    zh: '没有匹配的曲目',
    en: 'No matching tracks',
    ja: '一致するトラックがありません',
    ko: '일치하는 트랙이 없습니다',
    de: 'Keine passenden Titel gefunden',
    fr: 'Aucun titre correspondant'
  },
  'library.tryAdjustingSearch': {
    zh: '尝试调整搜索关键词',
    en: 'Try adjusting your search query',
    ja: '検索キーワードを変更してください',
    ko: '검색어를 조정해 보세요',
    de: 'Versuchen Sie, Ihre Suchanfrage anzupassen',
    fr: 'Essayez d\'ajuster votre recherche'
  },
  'library.noTracksImported': {
    zh: '还没有导入曲目',
    en: 'No tracks imported yet',
    ja: 'まだトラックがインポートされていません',
    ko: '아직 가져온 트랙이 없습니다',
    de: 'Noch keine Titel importiert',
    fr: 'Aucun titre importé'
  },
  'library.useSidebarToImport': {
    zh: '使用侧边栏导入您的音频文件',
    en: 'Use the sidebar to import your audio files',
    ja: 'サイドバーからオーディオファイルをインポート',
    ko: '사이드바에서 오디오 파일을 가져오세요',
    de: 'Verwenden Sie die Seitenleiste, um Audio-Dateien zu importieren',
    fr: 'Utilisez la barre latérale pour importer vos fichiers audio'
  },
  'library.needReimport': {
    zh: '(需要重新导入)',
    en: '(Need re-import)',
    ja: '(再インポートが必要)',
    ko: '(다시 가져오기 필요)',
    de: '(Neuimport erforderlich)',
    fr: '(Réimportation nécessaire)'
  },
  'library.locateToCurrent': {
    zh: '定位到当前播放',
    en: 'Locate to current',
    ja: '現在の再生位置へ',
    ko: '현재 재생 위치로',
    de: 'Zur aktuellen Wiedergabe springen',
    fr: 'Aller à la lecture actuelle'
  },
  'library.deleteConfirmTitle': {
    zh: '确认删除',
    en: 'Confirm Delete',
    ja: '削除の確認',
    ko: '삭제 확인',
    de: 'Löschen bestätigen',
    fr: 'Confirmer la suppression'
  },
  'library.deleteConfirmMessage': {
    zh: '确定要删除这首歌曲吗？此操作无法撤销。',
    en: 'Are you sure you want to delete this track? This action cannot be undone.',
    ja: 'このトラックを削除してもよろしいですか？この操作は元に戻せません。',
    ko: '이 트랙을 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.',
    de: 'Möchten Sie diesen Titel wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
    fr: 'Êtes-vous sûr de vouloir supprimer ce titre ? Cette action ne peut pas être annulée.'
  },
  'library.deleteSelectedConfirmMessage': {
    zh: '确定要删除选中的 {count} 首歌曲吗？此操作无法撤销。',
    en: 'Are you sure you want to delete {count} selected tracks? This action cannot be undone.',
    ja: '選択された {count} 曲のトラックを削除してもよろしいですか？この操作は元に戻せません。',
    ko: '선택된 {count} 곡의 트랙을 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.',
    de: 'Möchten Sie {count} ausgewählte Titel wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
    fr: 'Êtes-vous sûr de vouloir supprimer {count} titres sélectionnés ? Cette action ne peut pas être annulée.'
  },
  'library.dropFiles': {
    zh: '拖放音频文件到这里',
    en: 'Drop audio files here',
    ja: 'オーディオファイルをドロップ',
    ko: '오디오 파일을 여기에 놓으세요',
    de: 'Audio-Dateien hier ablegen',
    fr: 'Déposez les fichiers audio ici'
  },
  'library.supportFormats': {
    zh: '支持 FLAC, MP3, M4A, WAV 格式',
    en: 'Supports FLAC, MP3, M4A, WAV',
    ja: 'FLAC, MP3, M4A, WAV に対応',
    ko: 'FLAC, MP3, M4A, WAV 지원',
    de: 'Unterstützt FLAC, MP3, M4A, WAV',
    fr: 'Supporte FLAC, MP3, M4A, WAV'
  },

  // Browse View
  'browse.title': {
    zh: '浏览',
    en: 'Browse',
    ja: 'ブラウズ',
    ko: '찾아보기',
    de: 'Durchsuchen',
    fr: 'Parcourir'
  },
  'browse.searchResults': {
    zh: '搜索结果：',
    en: 'Search results for',
    ja: '検索結果：',
    ko: '검색 결과：',
    de: 'Suchergebnisse für',
    fr: 'Résultats de recherche pour'
  },
  'browse.recommended': {
    zh: '推荐',
    en: 'Recommended',
    ja: 'おすすめ',
    ko: '추천',
    de: 'Empfohlen',
    fr: 'Recommandé'
  },
  'browse.loading': {
    zh: '加载中...',
    en: 'Loading...',
    ja: '読み込み中...',
    ko: '로딩 중...',
    de: 'Laden...',
    fr: 'Chargement...'
  },
  'browse.error': {
    zh: '出错了',
    en: 'Error',
    ja: 'エラー',
    ko: '오류',
    de: 'Fehler',
    fr: 'Erreur'
  },
  'browse.retry': {
    zh: '重试',
    en: 'Retry',
    ja: '再試行',
    ko: '재시도',
    de: 'Wiederholen',
    fr: 'Réessayer'
  },
  'browse.openSettings': {
    zh: '打开设置',
    en: 'Open Settings',
    ja: '設定を開く',
    ko: '설정 열기',
    de: 'Einstellungen öffnen',
    fr: 'Ouvrir les paramètres'
  },
  'browse.browserLimitTitle': {
    zh: '提示：浏览功能需要在桌面端使用，因为浏览器存在跨域限制。',
    en: 'Tip: Browse feature requires desktop app due to browser CORS limitations.',
    ja: 'ヒント：ブラウザのCORS制限のため、ブラウズ機能にはデスクトップアプリが必要です。',
    ko: '팁：브라우저 CORS 제한으로 인해 찾아보기 기능은 데스크톱 앱이 필요합니다.',
    de: 'Hinweis: Die Durchsuchen-Funktion erfordert die Desktop-App aufgrund von Browser-CORS-Beschränkungen.',
    fr: 'Astuce : La fonction de navigation nécessite l\'application de bureau en raison des limitations CORS du navigateur.'
  },
  'browse.buildDesktop': {
    zh: '构建桌面版：npm run electron:build',
    en: 'Build desktop: npm run electron:build',
    ja: 'デスクトップ版ビルド：npm run electron:build',
    ko: '데스크톱 빌드：npm run electron:build',
    de: 'Desktop-Version bauen: npm run electron:build',
    fr: 'Construire la version bureau : npm run electron:build'
  },
  'browse.noMusic': {
    zh: '暂无音乐',
    en: 'No music available',
    ja: '音楽がありません',
    ko: '음악이 없습니다',
    de: 'Keine Musik verfügbar',
    fr: 'Aucune musique disponible'
  },
  'browse.tryDifferentKeywords': {
    zh: '尝试其他搜索关键词',
    en: 'Try different search keywords',
    ja: '別のキーワードで検索',
    ko: '다른 검색어로 시도하세요',
    de: 'Versuchen Sie andere Suchbegriffe',
    fr: 'Essayez d\'autres mots-clés de recherche'
  },
  'browse.setCookieToGetRecommended': {
    zh: '请设置访问凭证以获取推荐',
    en: 'Please set access credentials to get recommendations',
    ja: 'おすすめを受け取るには認証情報を設定してください',
    ko: '추천을 받으려면 액세스 자격 증명을 설정하세요',
    de: 'Bitte setzen Sie Zugriffsanmeldeinformationen, um Empfehlungen zu erhalten',
    fr: 'Veuillez définir les informations d\'identification pour obtenir des recommandations'
  },
  'browse.refresh': {
    zh: '刷新',
    en: 'Refresh',
    ja: '更新',
    ko: '새로고침',
    de: 'Aktualisieren',
    fr: 'Actualiser'
  },
  'browse.actionCol': {
    zh: '操作',
    en: 'Action',
    ja: 'アクション',
    ko: '작업',
    de: 'Aktion',
    fr: 'Action'
  },
  'browse.download': {
    zh: '下载',
    en: 'Download',
    ja: 'ダウンロード',
    ko: '다운로드',
    de: 'Herunterladen',
    fr: 'Télécharger'
  },
  'browse.standard': {
    zh: '标准',
    en: 'Standard',
    ja: '標準',
    ko: '표준',
    de: 'Standard',
    fr: 'Standard'
  },
  'browse.highQuality': {
    zh: '高品质',
    en: 'High Quality',
    ja: '高品質',
    ko: '고품질',
    de: 'Hohe Qualität',
    fr: 'Haute qualité'
  },
  'browse.lossless': {
    zh: '无损',
    en: 'Lossless',
    ja: 'ロスレス',
    ko: '무손실',
    de: 'Verlustfrei',
    fr: 'Sans perte'
  },
  'browse.completed': {
    zh: '完成',
    en: 'Completed',
    ja: '完了',
    ko: '완료',
    de: 'Abgeschlossen',
    fr: 'Terminé'
  },
  'browse.corsError': {
    zh: '浏览器安全限制：无法直接访问音乐服务API。请在桌面端使用此功能。',
    en: 'Browser security restriction: Cannot access music service API directly. Please use desktop app.',
    ja: 'ブラウザのセキュリティ制限：音楽サービスAPIに直接アクセスできません。デスクトップアプリをご利用ください。',
    ko: '브라우저 보안 제한：음악 서비스 API에 직접 액세스할 수 없습니다. 데스크톱 앱을 사용하세요.',
    de: 'Browser-Sicherheitsbeschränkung: Direkter Zugriff auf Musikdienst-API nicht möglich. Bitte verwenden Sie die Desktop-App.',
    fr: 'Restriction de sécurité du navigateur : Impossible d\'accéder directement à l\'API du service de musique. Veuillez utiliser l\'application de bureau.'
  },
  'browse.cookieExpired': {
    zh: '访问凭证已过期，请重新设置',
    en: 'Access credentials expired, please reconfigure',
    ja: '認証情報の有効期限が切れました。再設定してください',
    ko: '액세스 자격 증명이 만료되었습니다. 다시 설정하세요',
    de: 'Zugriffsanmeldeinformationen abgelaufen, bitte neu konfigurieren',
    fr: 'Informations d\'identification expirées, veuillez reconfigurer'
  },
  'browse.searchFailed': {
    zh: '搜索失败，请稍后重试',
    en: 'Search failed, please try again later',
    ja: '検索に失敗しました。後でもう一度お試しください',
    ko: '검색에 실패했습니다. 나중에 다시 시도하세요',
    de: 'Suche fehlgeschlagen, bitte später erneut versuchen',
    fr: 'La recherche a échoué, veuillez réessayer plus tard'
  },
  'browse.pleaseSetCookie': {
    zh: '请先设置访问凭证',
    en: 'Please set access credentials first',
    ja: '先に認証情報を設定してください',
    ko: '먼저 액세스 자격 증명을 설정하세요',
    de: 'Bitte zuerst Zugriffsanmeldeinformationen festlegen',
    fr: 'Veuillez d\'abord définir les informations d\'identification'
  },
  'browse.selectDownloadPath': {
    zh: '请先在设置中选择下载目录',
    en: 'Please select download folder in settings first',
    ja: '先に設定でダウンロードフォルダを選択してください',
    ko: '먼저 설정에서 다운로드 폴더를 선택하세요',
    de: 'Bitte wählen Sie zuerst den Download-Ordner in den Einstellungen',
    fr: 'Veuillez d\'abord sélectionner le dossier de téléchargement dans les paramètres'
  },
  'browse.downloadFailed': {
    zh: '下载失败',
    en: 'Download failed',
    ja: 'ダウンロードに失敗しました',
    ko: '다운로드 실패',
    de: 'Download fehlgeschlagen',
    fr: 'Téléchargement échoué'
  },

  // Settings View
  'settings.title': {
    zh: '设置',
    en: 'Settings',
    ja: '設定',
    ko: '설정',
    de: 'Einstellungen',
    fr: 'Paramètres'
  },
  'settings.description': {
    zh: '自定义您的应用偏好设置',
    en: 'Customize your application preferences',
    ja: 'アプリの設定をカスタマイズ',
    ko: '앱 설정 사용자 지정',
    de: 'Passen Sie Ihre Anwendungseinstellungen an',
    fr: 'Personnalisez vos préférences d\'application'
  },
  'settings.language': {
    zh: '语言',
    en: 'Language',
    ja: '言語',
    ko: '언어',
    de: 'Sprache',
    fr: 'Langue'
  },
  'settings.language.zh': {
    zh: '中文',
    en: 'Chinese',
    ja: '中国語',
    ko: '중국어',
    de: 'Chinesisch',
    fr: 'Chinois'
  },
  'settings.language.en': {
    zh: 'English',
    en: 'English',
    ja: '英語',
    ko: '영어',
    de: 'Englisch',
    fr: 'Anglais'
  },
  'settings.language.ja': {
    zh: '日语',
    en: 'Japanese',
    ja: '日本語',
    ko: '일본어',
    de: 'Japanisch',
    fr: 'Japonais'
  },
  'settings.language.ko': {
    zh: '韩语',
    en: 'Korean',
    ja: '韓国語',
    ko: '한국어',
    de: 'Koreanisch',
    fr: 'Coréen'
  },
  'settings.language.de': {
    zh: '德语',
    en: 'German',
    ja: 'ドイツ語',
    ko: '독일어',
    de: 'Deutsch',
    fr: 'Allemand'
  },
  'settings.language.fr': {
    zh: '法语',
    en: 'French',
    ja: 'フランス語',
    ko: '프랑스어',
    de: 'Französisch',
    fr: 'Français'
  },
  'settings.about': {
    zh: '关于',
    en: 'About',
    ja: 'について',
    ko: '정보',
    de: 'Über',
    fr: 'À propos'
  },

  // Theme View
  'theme.title': {
    zh: '主题',
    en: 'Theme',
    ja: 'テーマ',
    ko: '테마',
    de: 'Thema',
    fr: 'Thème'
  },
  'theme.description': {
    zh: '个性化您的界面外观',
    en: 'Personalize your interface appearance',
    ja: 'インターフェースの外観をカスタマイズ',
    ko: '인터페이스 모양 개인화',
    de: 'Personalisieren Sie das Erscheinungsbild Ihrer Oberfläche',
    fr: 'Personnalisez l\'apparence de votre interface'
  },
  'theme.comingSoon': {
    zh: '主题功能即将推出',
    en: 'Theme feature coming soon',
    ja: 'テーマ機能は近日公開',
    ko: '테마 기능 곧 출시 예정',
    de: 'Themen-Funktion kommt bald',
    fr: 'La fonctionnalité de thème arrive bientôt'
  },
  'theme.selectTheme': {
    zh: '选择主题',
    en: 'Select Theme',
    ja: 'テーマを選択',
    ko: '테마 선택',
    de: 'Thema auswählen',
    fr: 'Sélectionner un thème'
  },
  'theme.preview': {
    zh: '预览',
    en: 'Preview',
    ja: 'プレビュー',
    ko: '미리보기',
    de: 'Vorschau',
    fr: 'Aperçu'
  },
  'theme.apply': {
    zh: '应用',
    en: 'Apply',
    ja: '適用',
    ko: '적용',
    de: 'Anwenden',
    fr: 'Appliquer'
  },
  'theme.applied': {
    zh: '已应用',
    en: 'Applied',
    ja: '適用済み',
    ko: '적용됨',
    de: 'Angewendet',
    fr: 'Appliqué'
  },
  'theme.current': {
    zh: '当前主题',
    en: 'Current Theme',
    ja: '現在のテーマ',
    ko: '현재 테마',
    de: 'Aktuelles Thema',
    fr: 'Thème actuel'
  },
  'theme.darkMode': {
    zh: '深色主题',
    en: 'Dark Theme',
    ja: 'ダークテーマ',
    ko: '다크 테마',
    de: 'Dunkles Thema',
    fr: 'Thème sombre'
  },
  'theme.lightMode': {
    zh: '浅色主题',
    en: 'Light Theme',
    ja: 'ライトテーマ',
    ko: '라이트 테마',
    de: 'Helles Thema',
    fr: 'Thème clair'
  },

  // Theme names
  'theme.name.default': {
    zh: '经典蓝',
    en: 'Classic Blue',
    ja: 'クラシックブルー',
    ko: '클래식 블루',
    de: 'Klassisches Blau',
    fr: 'Bleu classique'
  },
  'theme.name.cute': {
    zh: '可爱粉',
    en: 'Cute Pink',
    ja: 'キュートピンク',
    ko: '귀여운 핑크',
    de: 'Süßes Rosa',
    fr: 'Rose mignon'
  },
  'theme.name.ocean': {
    zh: '海洋蓝',
    en: 'Ocean Blue',
    ja: 'オーシャンブルー',
    ko: '오션 블루',
    de: 'Ozeanblau',
    fr: 'Bleu océan'
  },
  'theme.name.sunset': {
    zh: '落日橙',
    en: 'Sunset Orange',
    ja: 'サンセットオレンジ',
    ko: '선셋 오렌지',
    de: 'Sonnenuntergangs-Orange',
    fr: 'Orange coucher de soleil'
  },
  'theme.name.forest': {
    zh: '森林绿',
    en: 'Forest Green',
    ja: 'フォレストグリーン',
    ko: '포레스트 그린',
    de: 'Waldgrün',
    fr: 'Vert forêt'
  },
  'theme.name.midnight': {
    zh: '午夜紫',
    en: 'Midnight Purple',
    ja: 'ミッドナイトパープル',
    ko: '미드나이트 퍼플',
    de: 'Mitternachtslila',
    fr: 'Violet minuit'
  },
  'theme.name.warm': {
    zh: '暖米',
    en: 'Warm Cream',
    ja: 'ウォームクリーム',
    ko: '웜 크림',
    de: 'Warme Creme',
    fr: 'Crème chaud'
  },
  'theme.name.glacier': {
    zh: '冰川蓝',
    en: 'Glacier Blue',
    ja: 'グレイシャーブルー',
    ko: '글레이셔 블루',
    de: 'Gletscherblau',
    fr: 'Bleu Glacier'
  },

  // Theme descriptions
  'theme.desc.default': {
    zh: '默认主题，经典蓝色调',
    en: 'Default theme with classic blue tones',
    ja: 'デフォルトテーマ、クラシックブルー',
    ko: '기본 테마, 클래식 블루 톤',
    de: 'Standard-Design mit klassischen Blautönen',
    fr: 'Thème par défaut aux tons bleus classiques'
  },
  'theme.desc.cute': {
    zh: '甜美可爱，粉色系主题',
    en: 'Sweet and cute pink theme',
    ja: 'スイートでキュートなピンクテーマ',
    ko: '달콤하고 귀여운 핑크 테마',
    de: 'Süßes rosa Design',
    fr: 'Thème rose doux et mignon'
  },
  'theme.desc.ocean': {
    zh: '深邃海洋，宁静致远',
    en: 'Deep ocean, peaceful and serene',
    ja: '深遠な海洋、平和で静寂',
    ko: '깊은 바다, 평화롭고 고요함',
    de: 'Tiefer Ozean, friedlich und ruhig',
    fr: 'Océan profond, paisible et serein'
  },
  'theme.desc.sunset': {
    zh: '温暖落日，温馨舒适',
    en: 'Warm sunset, cozy and comfortable',
    ja: '温かい夕日、居心地良い',
    ko: '따뜻한 일몰, 아늑하고 편안함',
    de: 'Warmer Sonnenuntergang, gemütlich',
    fr: 'Coucher de soleil chaud, douillet'
  },
  'theme.desc.forest': {
    zh: '清新自然，绿意盎然',
    en: 'Fresh and natural green theme',
    ja: '爽やかで自然なグリーンテーマ',
    ko: '상쾌하고 자연적인 그린 테마',
    de: 'Frisches und natürliches Grün',
    fr: 'Thème vert frais et naturel'
  },
  'theme.desc.midnight': {
    zh: '神秘优雅，深邃迷人',
    en: 'Mysterious and elegant purple',
    ja: '神秘的でエレガントなパープル',
    ko: '신비롭고 우아한 퍼플',
    de: 'Geheimnisvolles und elegantes Lila',
    fr: 'Violet mystérieux et élégant'
  },
  'theme.desc.warm': {
    zh: '温暖米色，极简留白',
    en: 'Warm cream, minimalist and spacious',
    ja: '温かいクリーム色、ミニマルで宽敞',
    ko: '따뜻한 크림색, 미니멀하고 넓은',
    de: 'Warmes Creme, minimalistisch und geräumig',
    fr: 'Crème chaud, minimaliste et spacieux'
  },
  'theme.desc.glacier': {
    zh: '清新明亮，冷色调现代风格',
    en: 'Fresh and bright, modern cool-toned style',
    ja: '爽やかで明亮、モダンな寒色系',
    ko: '상쾌하고 밝은, 모던한 쿨톤',
    de: 'Frisch und hell, moderner kühler Ton',
    fr: 'Frais et lumineux, style moderne frais'
  },

  // Theme tags
  'theme.tag.default': {
    zh: '默认',
    en: 'Default',
    ja: 'デフォルト',
    ko: '기본',
    de: 'Standard',
    fr: 'Par défaut'
  },
  'theme.tag.classic': {
    zh: '经典',
    en: 'Classic',
    ja: 'クラシック',
    ko: '클래식',
    de: 'Klassisch',
    fr: 'Classique'
  },
  'theme.tag.business': {
    zh: '商务',
    en: 'Business',
    ja: 'ビジネス',
    ko: '비즈니스',
    de: 'Geschäftlich',
    fr: 'Affaires'
  },
  'theme.tag.cute': {
    zh: '可爱',
    en: 'Cute',
    ja: 'キュート',
    ko: '귀여운',
    de: 'Süß',
    fr: 'Mignon'
  },
  'theme.tag.sweet': {
    zh: '甜美',
    en: 'Sweet',
    ja: 'スイート',
    ko: '스위트',
    de: 'Süß',
    fr: 'Doux'
  },
  'theme.tag.pink': {
    zh: '粉色',
    en: 'Pink',
    ja: 'ピンク',
    ko: '핑크',
    de: 'Rosa',
    fr: 'Rose'
  },
  'theme.tag.ocean': {
    zh: '海洋',
    en: 'Ocean',
    ja: 'オーシャン',
    ko: '오션',
    de: 'Ozean',
    fr: 'Océan'
  },
  'theme.tag.blue': {
    zh: '蓝色',
    en: 'Blue',
    ja: 'ブルー',
    ko: '블루',
    de: 'Blau',
    fr: 'Bleu'
  },
  'theme.tag.deep': {
    zh: '深邃',
    en: 'Deep',
    ja: '深遠',
    ko: '깊은',
    de: 'Tief',
    fr: 'Profond'
  },
  'theme.tag.warm': {
    zh: '温暖',
    en: 'Warm',
    ja: '温かい',
    ko: '따뜻한',
    de: 'Warm',
    fr: 'Chaud'
  },
  'theme.tag.orange': {
    zh: '橙色',
    en: 'Orange',
    ja: 'オレンジ',
    ko: '오렌지',
    de: 'Orange',
    fr: 'Orange'
  },
  'theme.tag.cozy': {
    zh: '舒适',
    en: 'Cozy',
    ja: '居心地良い',
    ko: '편안한',
    de: 'Gemütlich',
    fr: 'Douillet'
  },
  'theme.tag.natural': {
    zh: '自然',
    en: 'Natural',
    ja: '自然',
    ko: '자연적인',
    de: 'Natürlich',
    fr: 'Naturel'
  },
  'theme.tag.green': {
    zh: '绿色',
    en: 'Green',
    ja: 'グリーン',
    ko: '그린',
    de: 'Grün',
    fr: 'Vert'
  },
  'theme.tag.fresh': {
    zh: '清新',
    en: 'Fresh',
    ja: '爽やか',
    ko: '상쾌한',
    de: 'Frisch',
    fr: 'Frais'
  },
  'theme.tag.mysterious': {
    zh: '神秘',
    en: 'Mysterious',
    ja: '神秘的',
    ko: '신비로운',
    de: 'Geheimnisvoll',
    fr: 'Mystérieux'
  },
  'theme.tag.purple': {
    zh: '紫色',
    en: 'Purple',
    ja: 'パープル',
    ko: '퍼플',
    de: 'Lila',
    fr: 'Violet'
  },
  'theme.tag.elegant': {
    zh: '优雅',
    en: 'Elegant',
    ja: 'エレガント',
    ko: '우아한',
    de: 'Elegant',
    fr: 'Élégant'
  },
  'theme.tag.minimal': {
    zh: '极简',
    en: 'Minimal',
    ja: 'ミニマル',
    ko: '미니멀',
    de: 'Minimal',
    fr: 'Minimaliste'
  },
  'theme.tag.light': {
    zh: '浅色',
    en: 'Light',
    ja: 'ライト',
    ko: '라이트',
    de: 'Hell',
    fr: 'Clair'
  },
  'theme.tag.cool': {
    zh: '冷色',
    en: 'Cool',
    ja: 'クール',
    ko: '쿨',
    de: 'Kühl',
    fr: 'Frais'
  },
  'theme.tag.modern': {
    zh: '现代',
    en: 'Modern',
    ja: 'モダン',
    ko: '모던',
    de: 'Modern',
    fr: 'Moderne'
  },

  // Settings Dialog (BrowseView)
  'settingsDialog.title': {
    zh: '设置',
    en: 'Settings',
    ja: '設定',
    ko: '설정',
    de: 'Einstellungen',
    fr: 'Paramètres'
  },
  'settingsDialog.cookie': {
    zh: 'Cookie',
    en: 'Cookie',
    ja: 'Cookie',
    ko: 'Cookie',
    de: 'Cookie',
    fr: 'Cookie'
  },
  'settingsDialog.pasteCookie': {
    zh: '粘贴 Cookie...',
    en: 'Paste cookie...',
    ja: 'Cookieを貼り付け...',
    ko: 'Cookie 붙여넣기...',
    de: 'Cookie einfügen...',
    fr: 'Coller le cookie...'
  },
  'settingsDialog.savePath': {
    zh: '保存路径',
    en: 'Save Path',
    ja: '保存パス',
    ko: '저장 경로',
    de: 'Speicherpfad',
    fr: 'Chemin de sauvegarde'
  },
  'settingsDialog.downloadFolderPath': {
    zh: '下载文件夹路径...',
    en: 'Download folder path...',
    ja: 'ダウンロードフォルダパス...',
    ko: '다운로드 폴더 경로...',
    de: 'Download-Ordner Pfad...',
    fr: 'Chemin du dossier de téléchargement...'
  },
  'settingsDialog.tip': {
    zh: '提示：路径中的 ~ 会自动展开为 home 目录（如 ~/Music → /Users/xxx/Music）',
    en: 'Tip: ~ in path will be expanded to home directory (e.g. ~/Music → /Users/xxx/Music)',
    ja: 'ヒント：パス内の ~ はホームディレクトリに展開されます（例：~/Music → /Users/xxx/Music）',
    ko: '팁：경로의 ~ 는 홈 디렉토리로 확장됩니다（예：~/Music → /Users/xxx/Music）',
    de: 'Hinweis: ~ im Pfad wird zum Home-Verzeichnis erweitert (z.B. ~/Music → /Users/xxx/Music)',
    fr: 'Astuce : ~ dans le chemin sera étendu au répertoire personnel (ex: ~/Music → /Users/xxx/Music)'
  },
  'settingsDialog.close': {
    zh: '关闭',
    en: 'Close',
    ja: '閉じる',
    ko: '닫기',
    de: 'Schließen',
    fr: 'Fermer'
  },
  'settingsDialog.save': {
    zh: '保存',
    en: 'Save',
    ja: '保存',
    ko: '저장',
    de: 'Speichern',
    fr: 'Enregistrer'
  },
  'settingsDialog.saving': {
    zh: '保存中...',
    en: 'Saving...',
    ja: '保存中...',
    ko: '저장 중...',
    de: 'Speichern...',
    fr: 'Enregistrement...'
  },
  'settingsDialog.saved': {
    zh: '已保存',
    en: 'Saved',
    ja: '保存しました',
    ko: '저장됨',
    de: 'Gespeichert',
    fr: 'Enregistré'
  },
  'settingsDialog.saveFailed': {
    zh: '保存失败',
    en: 'Save failed',
    ja: '保存に失敗しました',
    ko: '저장 실패',
    de: 'Speichern fehlgeschlagen',
    fr: 'Échec de l\'enregistrement'
  },
  'settingsDialog.cookieInvalid': {
    zh: 'Cookie 无效',
    en: 'Cookie invalid',
    ja: 'Cookieが無効です',
    ko: 'Cookie가 잘못되었습니다',
    de: 'Cookie ungültig',
    fr: 'Cookie invalide'
  },

  // Player Controls
  'controls.playlist': {
    zh: '播放列表',
    en: 'Playlist',
    ja: 'プレイリスト',
    ko: '재생 목록',
    de: 'Wiedergabeliste',
    fr: 'Liste de lecture'
  },
  'controls.focusMode': {
    zh: '专注模式',
    en: 'Focus Mode',
    ja: 'フォーカスモード',
    ko: '집중 모드',
    de: 'Fokusmodus',
    fr: 'Mode concentré'
  },
  'controls.normalMode': {
    zh: '普通模式',
    en: 'Normal Mode',
    ja: '通常モード',
    ko: '일반 모드',
    de: 'Normalmodus',
    fr: 'Mode normal'
  },
  'controls.lyrics': {
    zh: '歌词',
    en: 'Lyrics',
    ja: '歌詞',
    ko: '가사',
    de: 'Liedtext',
    fr: 'Paroles'
  },
  'controls.repeatAll': {
    zh: '列表循环',
    en: 'Repeat All',
    ja: 'リピート',
    ko: '전체 반복',
    de: 'Alle wiederholen',
    fr: 'Tout répéter'
  },
  'controls.repeatOne': {
    zh: '单曲循环',
    en: 'Repeat One',
    ja: '1曲リピート',
    ko: '한 곡 반복',
    de: 'Einen wiederholen',
    fr: 'Répéter une fois'
  },
  // 'controls.shuffle': {
  //   zh: '随机播放',
  //   en: 'Shuffle',
  //   ja: 'シャッフル',
  //   ko: '무작위 재생',
  //   de: 'Zufällig',
  //   fr: 'Aléatoire'
  // },
  'controls.sequence': {
    zh: '顺序播放',
    en: 'Sequence',
    ja: '順次再生',
    ko: '순차 재생',
    de: 'Sequenz',
    fr: 'Séquence'
  },
  'controls.volume': {
    zh: '音量',
    en: 'Volume',
    ja: '音量',
    ko: '볼륨',
    de: 'Lautstärke',
    fr: 'Volume'
  },
  'controls.mute': {
    zh: '静音',
    en: 'Mute',
    ja: 'ミュート',
    ko: '음소거',
    de: 'Stumm',
    fr: 'Muet'
  },
  'controls.noTrackSelected': {
    zh: '未选择曲目',
    en: 'No track selected',
    ja: 'トラックが選択されていません',
    ko: '선택된 트랙이 없습니다',
    de: 'Kein Titel ausgewählt',
    fr: 'Aucun titre sélectionné'
  },
  'controls.shuffleMode': {
    zh: '随机播放',
    en: 'Shuffle',
    ja: 'シャッフル',
    ko: '무작위 재생',
    de: 'Zufällig',
    fr: 'Aléatoire'
  },
  'controls.repeatOneMode': {
    zh: '单曲循环',
    en: 'Repeat One',
    ja: '1曲リピート',
    ko: '한 곡 반복',
    de: 'Einen wiederholen',
    fr: 'Répéter une fois'
  },
  'controls.repeatAllMode': {
    zh: '顺序播放',
    en: 'Repeat All',
    ja: 'リピート',
    ko: '전체 반복',
    de: 'Alle wiederholen',
    fr: 'Tout répéter'
  },

  // Focus Mode
  'focusMode.title': {
    zh: '专注模式',
    en: 'Focus Mode',
    ja: 'フォーカスモード',
    ko: '집중 모드',
    de: 'Fokusmodus',
    fr: 'Mode concentré'
  },
  'focusMode.pureMusic': {
    zh: '纯音乐',
    en: 'Pure Music',
    ja: 'インストゥルメンタル',
    ko: '연주곡',
    de: 'Reine Musik',
    fr: 'Musique pure'
  },
  'focusMode.noLyrics': {
    zh: '暂无歌词',
    en: 'No lyrics available',
    ja: '歌詞がありません',
    ko: '가사가 없습니다',
    de: 'Keine Liedtexte verfügbar',
    fr: 'Pas de paroles disponibles'
  },

  // Queue Panel
  'queue.title': {
    zh: '播放列表',
    en: 'Playlist',
    ja: 'プレイリスト',
    ko: '재생 목록',
    de: 'Wiedergabeliste',
    fr: 'Liste de lecture'
  },
  'queue.empty': {
    zh: '播放列表为空',
    en: 'Playlist is empty',
    ja: 'プレイリストが空です',
    ko: '재생 목록이 비어 있습니다',
    de: 'Wiedergabeliste ist leer',
    fr: 'La liste de lecture est vide'
  },
  'queue.upNext': {
    zh: '即将播放',
    en: 'Up Next',
    ja: '次の曲',
    ko: '다음 곡',
    de: 'Als Nächstes',
    fr: 'Suivant'
  },
  'queue.viewFullQueue': {
    zh: '查看完整播放列表',
    en: 'View Full Queue',
    ja: 'プレイリスト全体を表示',
    ko: '전체 재생 목록 보기',
    de: 'Vollständige Warteschlange anzeigen',
    fr: 'Voir la file d\'attente complète'
  },
  'queue.emptyHint': {
    zh: '播放列表为空，导入文件后在这里显示。',
    en: 'Queue is empty. Import files to see them here.',
    ja: 'プレイリストが空です。ファイルをインポートするとここに表示されます。',
    ko: '재생 목록이 비어 있습니다. 파일을 가져오면 여기에 표시됩니다.',
    de: 'Warteschlange ist leer. Importieren Sie Dateien, um sie hier zu sehen.',
    fr: 'La file d\'attente est vide. Importez des fichiers pour les voir ici.'
  },

  // Main Player
  'mainPlayer.importTracks': {
    zh: '导入曲目开始收听',
    en: 'Import tracks to start listening',
    ja: 'トラックをインポートして再生を開始',
    ko: '트랙을 가져와서 재생을 시작하세요',
    de: 'Titel importieren, um mit dem Hören zu beginnen',
    fr: 'Importez des titres pour commencer à écouter'
  },

  // Lyrics Overlay
  'lyrics.noLyricsFound': {
    zh: '此 FLAC 文件中未找到歌词。',
    en: 'No lyrics found in this FLAC file.',
    ja: 'このFLACファイルには歌詞がありません。',
    ko: '이 FLAC 파일에 가사가 없습니다.',
    de: 'Keine Liedtexte in dieser FLAC-Datei gefunden.',
    fr: 'Aucune parole trouvée dans ce fichier FLAC.'
  },
  'lyrics.selectTrack': {
    zh: '选择一个曲目以查看歌词。',
    en: 'Select a track to view lyrics.',
    ja: '歌詞を表示するトラックを選択してください。',
    ko: '가사를 보려면 트랙을 선택하세요.',
    de: 'Wählen Sie einen Titel, um Liedtexte anzuzeigen.',
    fr: 'Sélectionnez un titre pour voir les paroles.'
  },

  // Title Bar
  'titleBar.minimize': {
    zh: '最小化',
    en: 'Minimize',
    ja: '最小化',
    ko: '최소화',
    de: 'Minimieren',
    fr: 'Réduire'
  },
  'titleBar.maximize': {
    zh: '最大化',
    en: 'Maximize',
    ja: '最大化',
    ko: '최대화',
    de: 'Maximieren',
    fr: 'Agrandir'
  },
  'titleBar.restore': {
    zh: '还原',
    en: 'Restore',
    ja: '元に戻す',
    ko: '복원',
    de: 'Wiederherstellen',
    fr: 'Restaurer'
  },
  'titleBar.close': {
    zh: '关闭',
    en: 'Close',
    ja: '閉じる',
    ko: '닫기',
    de: 'Schließen',
    fr: 'Fermer'
  },

  // Cookie Dialog
  'cookieDialog.title': {
    zh: '设置访问凭证',
    en: 'Set Access Credentials',
    ja: 'アクセス認証情報を設定',
    ko: '액세스 자격 증명 설정',
    de: 'Zugriffsanmeldeinformationen festlegen',
    fr: 'Définir les informations d\'identification'
  },
  'cookieDialog.description': {
    zh: '为了使用浏览功能，需要提供访问凭证。凭证每24小时需要重新验证一次。',
    en: 'To use the browse feature, you need to provide access credentials. Credentials need to be re-validated every 24 hours.',
    ja: 'ブラウズ機能を使用するには、アクセス認証情報を提供する必要があります。認証情報は24時間ごとに再検証が必要です。',
    ko: '찾아보기 기능을 사용하려면 액세스 자격 증명을 제공해야 합니다. 자격 증명은 24시간마다 재검증이 필요합니다.',
    de: 'Um die Durchsuchen-Funktion zu nutzen, müssen Sie Zugriffsanmeldeinformationen angeben. Diese müssen alle 24 Stunden neu validiert werden.',
    fr: 'Pour utiliser la fonction de navigation, vous devez fournir des informations d\'identification. Elles doivent être revalidées toutes les 24 heures.'
  },
  'cookieDialog.cookieLabel': {
    zh: 'Cookie',
    en: 'Cookie',
    ja: 'Cookie',
    ko: 'Cookie',
    de: 'Cookie',
    fr: 'Cookie'
  },
  'cookieDialog.pastePlaceholder': {
    zh: '粘贴你的访问凭证...',
    en: 'Paste your credentials...',
    ja: '認証情報を貼り付け...',
    ko: '자격 증명 붙여넣기...',
    de: 'Anmeldeinformationen einfügen...',
    fr: 'Collez vos informations d\'identification...'
  },
  'cookieDialog.enterCookie': {
    zh: '请输入Cookie',
    en: 'Please enter Cookie',
    ja: 'Cookieを入力してください',
    ko: 'Cookie를 입력하세요',
    de: 'Bitte Cookie eingeben',
    fr: 'Veuillez entrer le Cookie'
  },
  'cookieDialog.validateFailed': {
    zh: 'Cookie验证失败，请检查Cookie是否正确',
    en: 'Cookie validation failed, please check if Cookie is correct',
    ja: 'Cookieの検証に失敗しました。Cookieが正しいか確認してください',
    ko: 'Cookie 검증에 실패했습니다. Cookie가 올바른지 확인하세요',
    de: 'Cookie-Validierung fehlgeschlagen, bitte überprüfen Sie, ob das Cookie korrekt ist',
    fr: 'La validation du Cookie a échoué, veuillez vérifier si le Cookie est correct'
  },
  'cookieDialog.validateError': {
    zh: '验证过程中发生错误，请检查网络连接',
    en: 'Error during validation, please check your network connection',
    ja: '検証中にエラーが発生しました。ネットワーク接続を確認してください',
    ko: '검증 중 오류가 발생했습니다. 네트워크 연결을 확인하세요',
    de: 'Fehler während der Validierung, bitte überprüfen Sie Ihre Netzwerkverbindung',
    fr: 'Erreur lors de la validation, veuillez vérifier votre connexion réseau'
  },
  'cookieDialog.howToGet': {
    zh: '获取Cookie方法：',
    en: 'How to get Cookie:',
    ja: 'Cookieの取得方法：',
    ko: 'Cookie 얻는 방법：',
    de: 'So erhalten Sie das Cookie:',
    fr: 'Comment obtenir le Cookie :'
  },
  'cookieDialog.step1': {
    zh: '在浏览器中打开 y.qq.com 并登录',
    en: 'Open y.qq.com in browser and login',
    ja: 'ブラウザで y.qq.com を開いてログイン',
    ko: '브라우저에서 y.qq.com을 열고 로그인',
    de: 'Öffnen Sie y.qq.com im Browser und melden sich an',
    fr: 'Ouvrez y.qq.com dans le navigateur et connectez-vous'
  },
  'cookieDialog.step2': {
    zh: '按 F12 打开开发者工具',
    en: 'Press F12 to open Developer Tools',
    ja: 'F12 を押して開発者ツールを開く',
    ko: 'F12를 눌러 개발자 도구 열기',
    de: 'Drücken Sie F12, um die Entwicklertools zu öffnen',
    fr: 'Appuyez sur F12 pour ouvrir les outils de développement'
  },
  'cookieDialog.step3': {
    zh: '切换到 Network/网络 标签',
    en: 'Switch to Network tab',
    ja: 'Network タブに切り替え',
    ko: 'Network 탭으로 전환',
    de: 'Zum Netzwerk-Tab wechseln',
    fr: 'Passez à l\'onglet Réseau'
  },
  'cookieDialog.step4': {
    zh: '刷新页面，找到任意请求',
    en: 'Refresh page, find any request',
    ja: 'ページを更新し、任意のリクエストを見つける',
    ko: '페이지를 새로고침하고 아무 요청 찾기',
    de: 'Seite aktualisieren, beliebige Anfrage finden',
    fr: 'Actualisez la page, trouvez n\'importe quelle requête'
  },
  'cookieDialog.step5': {
    zh: '复制请求头中的 Cookie 字段',
    en: 'Copy Cookie field from request headers',
    ja: 'リクエストヘッダーから Cookie フィールドをコピー',
    ko: '요청 헤더에서 Cookie 필드 복사',
    de: 'Kopieren Sie das Cookie-Feld aus den Anfrage-Headern',
    fr: 'Copiez le champ Cookie des en-têtes de requête'
  },
  'cookieDialog.browserLimit': {
    zh: '浏览器环境限制：',
    en: 'Browser Environment Limitation:',
    ja: 'ブラウザ環境の制限：',
    ko: '브라우저 환경 제한：',
    de: 'Browser-Umgebungsbeschränkung:',
    fr: 'Limitation de l\'environnement du navigateur :'
  },
  'cookieDialog.browserLimitDesc': {
    zh: '由于浏览器跨域安全限制，浏览功能只能在桌面端使用。',
    en: 'Due to browser CORS restrictions, browse feature can only be used in desktop app.',
    ja: 'ブラウザのCORS制限により、ブラウズ機能はデスクトップアプリでのみ使用できます。',
    ko: '브라우저 CORS 제한으로 인해 찾아보기 기능은 데스크톱 앱에서만 사용할 수 있습니다.',
    de: 'Aufgrund von Browser-CORS-Beschränkungen kann die Durchsuchen-Funktion nur in der Desktop-App verwendet werden.',
    fr: 'En raison des restrictions CORS du navigateur, la fonction de navigation ne peut être utilisée que dans l\'application de bureau.'
  },
  'cookieDialog.buildDesktop': {
    zh: '构建桌面版：npm run electron:build',
    en: 'Build desktop: npm run electron:build',
    ja: 'デスクトップ版ビルド：npm run electron:build',
    ko: '데스크톱 빌드：npm run electron:build',
    de: 'Desktop-Version bauen: npm run electron:build',
    fr: 'Construire la version bureau : npm run electron:build'
  },
  'cookieDialog.cancel': {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
    ko: '취소',
    de: 'Abbrechen',
    fr: 'Annuler'
  },
  'cookieDialog.save': {
    zh: '保存',
    en: 'Save',
    ja: '保存',
    ko: '저장',
    de: 'Speichern',
    fr: 'Enregistrer'
  },
  'cookieDialog.validating': {
    zh: '验证中...',
    en: 'Validating...',
    ja: '検証中...',
    ko: '검증 중...',
    de: 'Validierung...',
    fr: 'Validation...'
  },

  // Error Boundary
  'errorBoundary.title': {
    zh: '出错了',
    en: 'Error',
    ja: 'エラー',
    ko: '오류',
    de: 'Fehler',
    fr: 'Erreur'
  },
  'errorBoundary.description': {
    zh: '应用遇到了意外错误',
    en: 'Application encountered an unexpected error',
    ja: 'アプリケーションで予期しないエラーが発生しました',
    ko: '애플리케이션에서 예기치 않은 오류가 발생했습니다',
    de: 'Anwendung ist auf einen unerwarteten Fehler gestoßen',
    fr: 'L\'application a rencontré une erreur inattendue'
  },
  'errorBoundary.errorLabel': {
    zh: '错误',
    en: 'Error',
    ja: 'エラー',
    ko: '오류',
    de: 'Fehler',
    fr: 'Erreur'
  },
  'errorBoundary.reload': {
    zh: '重新加载',
    en: 'Reload',
    ja: '再読み込み',
    ko: '새로고침',
    de: 'Neu laden',
    fr: 'Recharger'
  },

  // Common
  'common.close': {
    zh: '关闭',
    en: 'Close',
    ja: '閉じる',
    ko: '닫기',
    de: 'Schließen',
    fr: 'Fermer'
  },
  'common.save': {
    zh: '保存',
    en: 'Save',
    ja: '保存',
    ko: '저장',
    de: 'Speichern',
    fr: 'Enregistrer'
  },
  'common.cancel': {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
    ko: '취소',
    de: 'Abbrechen',
    fr: 'Annuler'
  },
  'common.delete': {
    zh: '删除',
    en: 'Delete',
    ja: '削除',
    ko: '삭제',
    de: 'Löschen',
    fr: 'Supprimer'
  },
  'common.edit': {
    zh: '编辑',
    en: 'Edit',
    ja: '編集',
    ko: '편집',
    de: 'Bearbeiten',
    fr: 'Modifier'
  },
  'common.done': {
    zh: '完成',
    en: 'Done',
    ja: '完了',
    ko: '완료',
    de: 'Fertig',
    fr: 'Terminé'
  },
  'common.loading': {
    zh: '加载中...',
    en: 'Loading...',
    ja: '読み込み中...',
    ko: '로딩 중...',
    de: 'Laden...',
    fr: 'Chargement...'
  },
  'common.error': {
    zh: '错误',
    en: 'Error',
    ja: 'エラー',
    ko: '오류',
    de: 'Fehler',
    fr: 'Erreur'
  },
  'common.success': {
    zh: '成功',
    en: 'Success',
    ja: '成功',
    ko: '성공',
    de: 'Erfolg',
    fr: 'Succès'
  },
  'common.unknown': {
    zh: '未知',
    en: 'Unknown',
    ja: '不明',
    ko: '알 수 없음',
    de: 'Unbekannt',
    fr: 'Inconnu'
  },
  'common.unknownArtist': {
    zh: '未知艺术家',
    en: 'Unknown Artist',
    ja: '不明なアーティスト',
    ko: '알 수 없는 아티스트',
    de: 'Unbekannter Künstler',
    fr: 'Artiste inconnu'
  },
  'common.unknownAlbum': {
    zh: '未知专辑',
    en: 'Unknown Album',
    ja: '不明なアルバム',
    ko: '알 수 없는 앨범',
    de: 'Unbekanntes Album',
    fr: 'Album inconnu'
  },

  // Shortcuts
  'settings.shortcuts.title': {
    zh: '快捷键',
    en: 'Keyboard Shortcuts',
    ja: 'キーボードショートカット',
    ko: '키보드 단축키',
    de: 'Tastenkürzel',
    fr: 'Raccourcis clavier'
  },
  'settings.shortcuts.description': {
    zh: '自定义您的键盘快捷键',
    en: 'Customize your keyboard shortcuts',
    ja: 'キーボードショートカットをカスタマイズ',
    ko: '키보드 단축키 사용자 지정',
    de: 'Passen Sie Ihre Tastenkürzel an',
    fr: 'Personnalisez vos raccourcis clavier'
  },
  'settings.shortcuts.playerGroup': {
    zh: '播放控制',
    en: 'Playback Controls',
    ja: '再生コントロール',
    ko: '재생 제어',
    de: 'Wiedergabesteuerung',
    fr: 'Contrôles de lecture'
  },
  'settings.shortcuts.navigationGroup': {
    zh: '导航',
    en: 'Navigation',
    ja: 'ナビゲーション',
    ko: '납치게이션',
    de: 'Navigation',
    fr: 'Navigation'
  },
  'settings.shortcuts.clickToEdit': {
    zh: '点击编辑',
    en: 'Click to edit',
    ja: 'クリックして編集',
    ko: '클릭하여 편집',
    de: 'Klicken zum Bearbeiten',
    fr: 'Cliquez pour modifier'
  },
  'settings.shortcuts.pressKey': {
    zh: '按键盘...',
    en: 'Press key...',
    ja: 'キーを押す...',
    ko: '키를 누르세요...',
    de: 'Taste drücken...',
    fr: 'Appuyez sur une touche...'
  },
  'settings.shortcuts.reset': {
    zh: '重置',
    en: 'Reset',
    ja: 'リセット',
    ko: '재설정',
    de: 'Zurücksetzen',
    fr: 'Réinitialiser'
  },
  'settings.shortcuts.resetAll': {
    zh: '重置所有',
    en: 'Reset All',
    ja: 'すべてリセット',
    ko: '모두 재설정',
    de: 'Alle zurücksetzen',
    fr: 'Tout réinitialiser'
  },
  'settings.shortcuts.resetAllConfirm': {
    zh: '重置所有快捷键？',
    en: 'Reset all shortcuts?',
    ja: 'すべてのショートカットをリセット？',
    ko: '모든 단축키를 재설정하시겠습니까?',
    de: 'Alle Tastenkürzel zurücksetzen?',
    fr: 'Réinitialiser tous les raccourcis ?'
  },
  'settings.shortcuts.resetAllDesc': {
    zh: '这将把所有快捷键恢复为默认设置。此操作无法撤销。',
    en: 'This will restore all shortcuts to their default settings. This action cannot be undone.',
    ja: 'すべてのショートカットをデフォルト設定に戻します。この操作は元に戻せません。',
    ko: '모든 단축키가 기본 설정으로 복원됩니다. 이 작업은 취소할 수 없습니다.',
    de: 'Dies stellt alle Tastenkürzel auf die Standardeinstellungen zurück. Diese Aktion kann nicht rückgängig gemacht werden.',
    fr: 'Cela restaurera tous les raccourcis à leurs paramètres par défaut. Cette action ne peut pas être annulée.'
  },
  'settings.shortcuts.conflict': {
    zh: '快捷键冲突',
    en: 'Shortcut conflict',
    ja: 'ショートカットの競合',
    ko: '단축키 충돌',
    de: 'Tastenkürzel-Konflikt',
    fr: 'Conflit de raccourci'
  },
  'settings.shortcuts.legend': {
    zh: '点击快捷键按钮并按键盘上的组合键来修改。按 Esc 取消编辑。',
    en: 'Click the shortcut button and press a key combination to change. Press Esc to cancel.',
    ja: 'ショートカットボタンをクリックしてキー組み合わせを押して変更。Escでキャンセル。',
    ko: '단축키 버튼을 클릭하고 키 조합을 눌러 변경하세요. Esc를 눌러 취소합니다.',
    de: 'Klicken Sie auf die Tastenkürzel-Schaltfläche und drücken Sie eine Tastenkombination zum Ändern. Drücken Sie Esc zum Abbrechen.',
    fr: 'Cliquez sur le bouton de raccourci et appuyez sur une combinaison de touches pour changer. Appuyez sur Échap pour annuler.'
  },
  'settings.shortcuts.legendClear': {
    zh: '按 Backspace 或 Delete 清除快捷键绑定。',
    en: 'Press Backspace or Delete to clear the shortcut binding.',
    ja: 'BackspaceまたはDeleteを押してショートカットをクリア。',
    ko: 'Backspace 또는 Delete를 눌러 단축키 바인딩을 지우세요.',
    de: 'Drücken Sie Backspace oder Delete, um die Tastenkürzel-Bindung zu löschen.',
    fr: 'Appuyez sur Retour arrière ou Supprimer pour effacer le raccourci.'
  },
  'settings.shortcuts.unbound': {
    zh: '未绑定',
    en: 'Unbound',
    ja: '未設定',
    ko: '미설정',
    de: 'Nicht belegt',
    fr: 'Non attribué'
  },
  'settings.shortcuts.clear': {
    zh: '清除',
    en: 'Clear',
    ja: 'クリア',
    ko: '지우기',
    de: 'Löschen',
    fr: 'Effacer'
  },

  // Shortcut action names
  'shortcut.playPause': {
    zh: '播放/暂停',
    en: 'Play/Pause',
    ja: '再生/一時停止',
    ko: '재생/일시정지',
    de: 'Wiedergabe/Pause',
    fr: 'Lecture/Pause'
  },
  'shortcut.playPauseDesc': {
    zh: '切换播放和暂停状态',
    en: 'Toggle play and pause',
    ja: '再生と一時停止を切り替え',
    ko: '재생 및 일시정지 전환',
    de: 'Wiedergabe und Pause umschalten',
    fr: 'Basculer entre lecture et pause'
  },
  'shortcut.nextTrack': {
    zh: '下一首',
    en: 'Next Track',
    ja: '次の曲',
    ko: '다음 곡',
    de: 'Nächster Titel',
    fr: 'Titre suivant'
  },
  'shortcut.nextTrackDesc': {
    zh: '切换到下一首曲目',
    en: 'Skip to the next track',
    ja: '次の曲にスキップ',
    ko: '다음 곡으로 걸러뛰기',
    de: 'Zum nächsten Titel springen',
    fr: 'Passer au titre suivant'
  },
  'shortcut.prevTrack': {
    zh: '上一首',
    en: 'Previous Track',
    ja: '前の曲',
    ko: '이전 곡',
    de: 'Vorheriger Titel',
    fr: 'Titre précédent'
  },
  'shortcut.prevTrackDesc': {
    zh: '切换到上一首曲目',
    en: 'Go to the previous track',
    ja: '前の曲に戻る',
    ko: '이전 곡으로 이동',
    de: 'Zum vorherigen Titel gehen',
    fr: 'Aller au titre précédent'
  },
  'shortcut.seekForward5s': {
    zh: '快进5秒',
    en: 'Seek Forward 5s',
    ja: '5秒進む',
    ko: '5초 앞으로',
    de: '5s vorwärts springen',
    fr: 'Avancer de 5s'
  },
  'shortcut.seekForward5sDesc': {
    zh: '向前快进5秒',
    en: 'Seek forward 5 seconds',
    ja: '5秒前に進む',
    ko: '5초 앞으로 건너뛰기',
    de: '5 Sekunden vorwärts springen',
    fr: 'Avancer de 5 secondes'
  },
  'shortcut.seekBackward5s': {
    zh: '快退5秒',
    en: 'Seek Backward 5s',
    ja: '5秒戻る',
    ko: '5초 뒤로',
    de: '5s zurück springen',
    fr: 'Reculer de 5s'
  },
  'shortcut.seekBackward5sDesc': {
    zh: '向后快退5秒',
    en: 'Seek backward 5 seconds',
    ja: '5秒前に戻る',
    ko: '5초 뒤로 건너뛰기',
    de: '5 Sekunden zurück springen',
    fr: 'Reculer de 5 secondes'
  },
  'shortcut.seekForward30s': {
    zh: '快进30秒',
    en: 'Seek Forward 30s',
    ja: '30秒進む',
    ko: '30초 앞으로',
    de: '30s vorwärts springen',
    fr: 'Avancer de 30s'
  },
  'shortcut.seekForward30sDesc': {
    zh: '向前快进30秒',
    en: 'Seek forward 30 seconds',
    ja: '30秒前に進む',
    ko: '30초 앞으로 건너뛰기',
    de: '30 Sekunden vorwärts springen',
    fr: 'Avancer de 30 secondes'
  },
  'shortcut.seekBackward30s': {
    zh: '快退30秒',
    en: 'Seek Backward 30s',
    ja: '30秒戻る',
    ko: '30초 뒤로',
    de: '30s zurück springen',
    fr: 'Reculer de 30s'
  },
  'shortcut.seekBackward30sDesc': {
    zh: '向后快退30秒',
    en: 'Seek backward 30 seconds',
    ja: '30秒前に戻る',
    ko: '30초 뒤로 건너뛰기',
    de: '30 Sekunden zurück springen',
    fr: 'Reculer de 30 secondes'
  },
  'shortcut.volumeUp': {
    zh: '音量增加',
    en: 'Volume Up',
    ja: '音量アップ',
    ko: '볼륨 업',
    de: 'Lautstärke erhöhen',
    fr: 'Augmenter le volume'
  },
  'shortcut.volumeUpDesc': {
    zh: '音量增加1%',
    en: 'Increase volume by 1%',
    ja: '音量を1%上げる',
    ko: '볼륨 1% 증가',
    de: 'Lautstärke um 1% erhöhen',
    fr: 'Augmenter le volume de 1%'
  },
  'shortcut.volumeDown': {
    zh: '音量减少',
    en: 'Volume Down',
    ja: '音量ダウン',
    ko: '볼륨 다운',
    de: 'Lautstärke verringern',
    fr: 'Diminuer le volume'
  },
  'shortcut.volumeDownDesc': {
    zh: '音量减少1%',
    en: 'Decrease volume by 1%',
    ja: '音量を1%下げる',
    ko: '볼륨 1% 감소',
    de: 'Lautstärke um 1% verringern',
    fr: 'Diminuer le volume de 1%'
  },
  'shortcut.volumeUp10': {
    zh: '音量增加10%',
    en: 'Volume Up 10%',
    ja: '音量10%アップ',
    ko: '볼륨 10% 업',
    de: 'Lautstärke +10%',
    fr: 'Volume +10%'
  },
  'shortcut.volumeUp10Desc': {
    zh: '音量增加10%',
    en: 'Increase volume by 10%',
    ja: '音量を10%上げる',
    ko: '볼륨 10% 증가',
    de: 'Lautstärke um 10% erhöhen',
    fr: 'Augmenter le volume de 10%'
  },
  'shortcut.volumeDown10': {
    zh: '音量减少10%',
    en: 'Volume Down 10%',
    ja: '音量10%ダウン',
    ko: '볼륨 10% 다운',
    de: 'Lautstärke -10%',
    fr: 'Volume -10%'
  },
  'shortcut.volumeDown10Desc': {
    zh: '音量减少10%',
    en: 'Decrease volume by 10%',
    ja: '音量を10%下げる',
    ko: '볼륨 10% 감소',
    de: 'Lautstärke um 10% verringern',
    fr: 'Diminuer le volume de 10%'
  },
  'shortcut.toggleMute': {
    zh: '静音切换',
    en: 'Toggle Mute',
    ja: 'ミュート切り替え',
    ko: '음소거 전환',
    de: 'Stumm umschalten',
    fr: 'Activer/désactiver le son'
  },
  'shortcut.toggleMuteDesc': {
    zh: '切换静音状态',
    en: 'Toggle mute on/off',
    ja: 'ミュートのオン/オフを切り替え',
    ko: '음소거 켜기/끄기 전환',
    de: 'Stumm ein/aus umschalten',
    fr: 'Activer/désactiver la sourdine'
  },
  'shortcut.enterFocusMode': {
    zh: '进入专注模式',
    en: 'Enter Focus Mode',
    ja: 'フォーカスモードに入る',
    ko: '집중 모드 진입',
    de: 'Fokusmodus betreten',
    fr: 'Entrer en mode concentré'
  },
  'shortcut.enterFocusModeDesc': {
    zh: '打开专注模式界面',
    en: 'Open focus mode view',
    ja: 'フォーカスモード画面を開く',
    ko: '집중 모드 보기 열기',
    de: 'Fokusmodus-Ansicht öffnen',
    fr: 'Ouvrir la vue mode concentré'
  },
  'shortcut.exitFocusMode': {
    zh: '退出专注模式',
    en: 'Exit Focus Mode',
    ja: 'フォーカスモードを終了',
    ko: '집중 모드 종료',
    de: 'Fokusmodus verlassen',
    fr: 'Quitter le mode concentré'
  },
  'shortcut.exitFocusModeDesc': {
    zh: '关闭专注模式界面',
    en: 'Close focus mode view',
    ja: 'フォーカスモード画面を閉じる',
    ko: '집중 모드 보기 닫기',
    de: 'Fokusmodus-Ansicht schließen',
    fr: 'Fermer la vue mode concentré'
  },
  'shortcut.focusSearch': {
    zh: '聚焦搜索框',
    en: 'Focus Search',
    ja: '検索ボックスにフォーカス',
    ko: '검색 상자에 포커스',
    de: 'Suche fokussieren',
    fr: 'Focus sur la recherche'
  },
  'shortcut.focusSearchDesc': {
    zh: '聚焦到搜索输入框',
    en: 'Focus the search input field',
    ja: '検索入力欄にフォーカス',
    ko: '검색 입력 필드에 포커스',
    de: 'Sucheingabefeld fokussieren',
    fr: 'Focus sur le champ de recherche'
  },
  'shortcut.importFiles': {
    zh: '导入文件',
    en: 'Import Files',
    ja: 'ファイルをインポート',
    ko: '파일 가져오기',
    de: 'Dateien importieren',
    fr: 'Importer des fichiers'
  },
  'shortcut.importFilesDesc': {
    zh: '打开文件导入对话框',
    en: 'Open file import dialog',
    ja: 'ファイルインポートダイアログを開く',
    ko: '파일 가져오기 대화 상자 열기',
    de: 'Dateiimport-Dialog öffnen',
    fr: 'Ouvrir la boîte de dialogue d\'importation'
  },
  'shortcut.gotoLibrary': {
    zh: '转到音乐库',
    en: 'Go to Library',
    ja: 'ライブラリへ移動',
    ko: '라이브러리로 이동',
    de: 'Zur Bibliothek',
    fr: 'Aller à la bibliothèque'
  },
  'shortcut.gotoLibraryDesc': {
    zh: '切换到音乐库界面',
    en: 'Switch to library view',
    ja: 'ライブラリ画面に切り替え',
    ko: '라이브러리 보기로 전환',
    de: 'Zur Bibliotheksansicht wechseln',
    fr: 'Passer à la vue bibliothèque'
  },
  'shortcut.gotoBrowse': {
    zh: '转到浏览',
    en: 'Go to Browse',
    ja: 'ブラウズへ移動',
    ko: '찾아보기로 이동',
    de: 'Zum Durchsuchen',
    fr: 'Aller à la navigation'
  },
  'shortcut.gotoBrowseDesc': {
    zh: '切换到浏览界面',
    en: 'Switch to browse view',
    ja: 'ブラウズ画面に切り替え',
    ko: '찾아보기 보기로 전환',
    de: 'Zur Durchsuchen-Ansicht wechseln',
    fr: 'Passer à la vue navigation'
  },
  'shortcut.gotoSettings': {
    zh: '转到设置',
    en: 'Go to Settings',
    ja: '設定へ移動',
    ko: '설정으로 이동',
    de: 'Zu den Einstellungen',
    fr: 'Aller aux paramètres'
  },
  'shortcut.gotoSettingsDesc': {
    zh: '切换到设置界面',
    en: 'Switch to settings view',
    ja: '設定画面に切り替え',
    ko: '설정 보기로 전환',
    de: 'Zur Einstellungsansicht wechseln',
    fr: 'Passer à la vue paramètres'
  },
  'shortcut.gotoTheme': {
    zh: '转到主题',
    en: 'Go to Theme',
    ja: 'テーマへ移動',
    ko: '테마로 이동',
    de: 'Zum Thema',
    fr: 'Aller au thème'
  },
  'shortcut.gotoThemeDesc': {
    zh: '切换到主题界面',
    en: 'Switch to theme view',
    ja: 'テーマ画面に切り替え',
    ko: '테마 보기로 전환',
    de: 'Zur Themenansicht wechseln',
    fr: 'Passer à la vue thème'
  },
  'shortcut.gotoMetadata': {
    zh: '转到元数据',
    en: 'Go to Metadata',
    ja: 'メタデータへ移動',
    ko: '메타데이터로 이동',
    de: 'Zu Metadaten',
    fr: 'Aller aux métadonnées'
  },
  'shortcut.gotoMetadataDesc': {
    zh: '切换到元数据编辑界面',
    en: 'Switch to metadata view',
    ja: 'メタデータ画面に切り替え',
    ko: '메타데이터 보기로 전환',
    de: 'Zur Metadatenansicht wechseln',
    fr: 'Passer à la vue métadonnées'
  },

  // Metadata View
  'metadataView.title': {
    zh: '元数据',
    en: 'Metadata',
    ja: 'メタデータ',
    ko: '메타데이터',
    de: 'Metadaten',
    fr: 'Métadonnées'
  },
  'metadataView.description': {
    zh: '编辑音频文件的元数据信息',
    en: 'Edit audio file metadata information',
    ja: 'オーディオファイルのメタデータを編集',
    ko: '오디오 파일 메타데이터 편집',
    de: 'Audio-Datei-Metadaten bearbeiten',
    fr: 'Modifier les métadonnées des fichiers audio'
  },
  'metadataView.importFiles': {
    zh: '导入文件',
    en: 'Import Files',
    ja: 'ファイルをインポート',
    ko: '파일 가져오기',
    de: 'Dateien importieren',
    fr: 'Importer des fichiers'
  },
  'metadataView.importFromLibrary': {
    zh: '从音乐库导入',
    en: 'Import from Library',
    ja: 'ライブラリからインポート',
    ko: '라이브러리에서 가져오기',
    de: 'Aus Bibliothek importieren',
    fr: 'Importer depuis la bibliothèque'
  },
  'metadataView.importedTracks': {
    zh: '已导入',
    en: 'Imported',
    ja: 'インポート済み',
    ko: '가져옴',
    de: 'Importiert',
    fr: 'Importé'
  },
  'metadataView.selectFromLibrary': {
    zh: '从音乐库选择',
    en: 'Select from Library',
    ja: 'ライブラリから選択',
    ko: '라이브러리에서 선택',
    de: 'Aus Bibliothek auswählen',
    fr: 'Sélectionner depuis la bibliothèque'
  },
  'metadataView.selectTrack': {
    zh: '请选择一首曲目',
    en: 'Please select a track',
    ja: 'トラックを選択してください',
    ko: '트랙을 선택하세요',
    de: 'Bitte wählen Sie einen Titel',
    fr: 'Veuillez sélectionner un titre'
  },
  'metadataView.importSelected': {
    zh: '导入所选',
    en: 'Import Selected',
    ja: '選択をインポート',
    ko: '선택 항목 가져오기',
    de: 'Ausgewählte importieren',
    fr: 'Importer la sélection'
  },
  'metadataView.importCover': {
    zh: '导入封面',
    en: 'Import Cover',
    ja: 'カバーをインポート',
    ko: '표지 가져오기',
    de: 'Cover importieren',
    fr: 'Importer la pochette'
  },
  'notifications.downloadComplete': {
    zh: '下载完成',
    en: 'Download Complete',
    ja: 'ダウンロード完了',
    ko: '다운로드 완료',
    de: 'Download abgeschlossen',
    fr: 'Téléchargement terminé'
  },
  'notifications.downloadFailed': {
    zh: '下载失败',
    en: 'Download Failed',
    ja: 'ダウンロード失敗',
    ko: '다운로드 실패',
    de: 'Download fehlgeschlagen',
    fr: 'Échec du téléchargement'
  },
  'notifications.addedToLibrary': {
    zh: '已添加到资料库',
    en: 'added to library',
    ja: 'ライブラリに追加',
    ko: '라이브러리에 추가됨',
    de: 'zur Bibliothek hinzugefügt',
    fr: 'ajouté à la bibliothèque'
  },
  'notifications.downloadFailedBody': {
    zh: '下载失败',
    en: 'download failed',
    ja: 'ダウンロードに失敗しました',
    ko: '다운로드 실패',
    de: 'Download fehlgeschlagen',
    fr: 'échec du téléchargement'
  },
  'notifications.importComplete': {
    zh: '导入完成',
    en: 'Import Complete',
    ja: 'インポート完了',
    ko: '가져오기 완료',
    de: 'Import abgeschlossen',
    fr: 'Importation terminée'
  },
  'notifications.importSuccessCount': {
    zh: '成功导入 {count} 首歌曲',
    en: 'Successfully imported {count} track(s)',
    ja: '{count} 曲のインポートに成功しました',
    ko: '{count}곡 가져오기 성공',
    de: '{count} Titel erfolgreich importiert',
    fr: '{count} piste(s) importée(s)'
  },
  'notifications.importPartialCount': {
    zh: '成功导入 {success} 首歌曲，{failed} 首失败',
    en: 'Imported {success} track(s), {failed} failed',
    ja: '{success} 曲インポート成功、{failed} 曲失敗',
    ko: '{success}곡 가져오기 성공, {failed}곡 실패',
    de: '{success} Titel importiert, {failed} fehlgeschlagen',
    fr: '{success} piste(s) importée(s), {failed} échouée(s)'
  },
  'notifications.saveFailed': {
    zh: '保存失败',
    en: 'Save Failed',
    ja: '保存失敗',
    ko: '저장 실패',
    de: 'Speichern fehlgeschlagen',
    fr: 'Échec de la sauvegarde'
  },
  'notifications.fieldSaveFailed': {
    zh: '{field} 保存失败',
    en: 'Failed to save {field}',
    ja: '{field} の保存に失敗しました',
    ko: '{field} 저장 실패',
    de: '{field} konnte nicht gespeichert werden',
    fr: 'Échec de la sauvegarde de {field}'
  },
  'notifications.coverSaveFailed': {
    zh: '封面图片保存失败',
    en: 'Failed to save cover image',
    ja: 'カバー画像の保存に失敗しました',
    ko: '표지 이미지 저장 실패',
    de: 'Cover-Bild konnte nicht gespeichert werden',
    fr: 'Échec de la sauvegarde de la pochette'
  }
};

const VALID_LANGUAGES: Language[] = ['zh', 'en', 'ja', 'ko', 'de', 'fr'];

class I18nManager {
  private currentLanguage: Language = 'zh';
  private listeners: Set<(lang: Language) => void> = new Set();

  constructor() {
    // Load saved language preference from localStorage
    const savedLang = localStorage.getItem('app-language') as Language;
    if (savedLang && VALID_LANGUAGES.includes(savedLang)) {
      this.currentLanguage = savedLang;
      logger.debug('[I18n] Loaded saved language:', savedLang);
    }
  }

  getLanguage(): Language {
    return this.currentLanguage;
  }

  setLanguage(lang: Language) {
    if (this.currentLanguage !== lang) {
      this.currentLanguage = lang;
      localStorage.setItem('app-language', lang);
      logger.debug('[I18n] Language changed to:', lang);
      this.notifyListeners();
    }
  }

  t(key: string): string {
    const translation = translations[key];
    if (!translation) {
      logger.warn('[I18n] Missing translation for key:', key);
      return key;
    }
    return translation[this.currentLanguage];
  }

  subscribe(listener: (lang: Language) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentLanguage));
  }
}

export const i18n = new I18nManager();