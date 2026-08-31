{
  "targets": [
    {
      "target_name": "windows_taskbar_native",
      "sources": [
        "src/addon.cc"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX",
        "_WIN32_WINNT=0x0A00"
      ],
      "win_delay_load_hook": "true",
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "user32.lib",
              "gdi32.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17",
                  "/EHsc"
                ],
                "ExceptionHandling": 1,
                "WarningLevel": 4
              }
            }
          }
        ]
      ]
    }
  ]
}
