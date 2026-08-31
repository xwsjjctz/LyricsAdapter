{
  "targets": [
    {
      "target_name": "macos_statusbar_native",
      "sources": [
        "src/addon.mm"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "libraries": [
              "-framework AppKit",
              "-framework Foundation"
            ],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            }
          }
        ]
      ]
    }
  ]
}
