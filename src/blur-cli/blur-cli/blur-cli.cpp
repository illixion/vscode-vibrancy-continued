#include "pch.h"
#include <dwmapi.h>
#include <iostream>
#include <algorithm>

struct ACCENTPOLICY {
	int nAccentState;
	int nFlags;
	int nColor;
	int nAnimationId;
};
struct WINCOMPATTRDATA {
	int nAttribute;
	PVOID pData;
	ULONG ulDataSize;
};

enum AccentTypes {
	ACCENT_DISABLE = 0,
	ACCENT_ENABLE_GRADIENT = 1,
	ACCENT_ENABLE_TRANSPARENTGRADIENT = 2,
	ACCENT_ENABLE_BLURBEHIND = 3,
	ACCENT_ENABLE_ACRYLIC = 4
};

enum BlurTypes {
	DWM_BLUR = 0,
	ACRYLIC_BLUR = 1
};

char* getCmdOption(char ** begin, char ** end, const std::string & option)
{
	char ** itr = std::find(begin, end, option);
	if (itr != end && ++itr != end)
	{
		return *itr;
	}
	return 0;
}

bool cmdOptionExists(char** begin, char** end, const std::string& option)
{
	return std::find(begin, end, option) != end;
}

int main(int argc, char *argv[], char *envp[])
{
	HWND handle = NULL;
	int blurtype = DWM_BLUR;
	double opacity = 0.86;
	bool enable = true;
	int color = 0x1e1e1e;

	handle = (HWND)atoi(argv[1]);

	if (cmdOptionExists(argv, argv + argc, "--type")) {
		char* value_str = getCmdOption(argv, argv + argc, "--type");
		if (strcmp(value_str, "acrylic") == 0) {
			blurtype = ACRYLIC_BLUR;
		}
		else if (strcmp(value_str, "dwm") == 0) {
			blurtype = DWM_BLUR;
		}
	}

	if (cmdOptionExists(argv, argv + argc, "--enable")) {
		char* value_str = getCmdOption(argv, argv + argc, "--enable");
		if (strcmp(value_str, "false") == 0) {
			enable = false;
		}
		else if (strcmp(value_str, "true") == 0) {
			enable = true;
		}
	}

	if (cmdOptionExists(argv, argv + argc, "--opacity")) {
		char* value_str = getCmdOption(argv, argv + argc, "--opacity");
		opacity = atof(value_str);
	}

	if (cmdOptionExists(argv, argv + argc, "--color")) {
		char* value_str = getCmdOption(argv, argv + argc, "--color");
		char* ptr;
		color = strtol(value_str, &ptr, 16);
	}

	if (blurtype == DWM_BLUR) {
		// Create and populate the Blur Behind structure
		DWM_BLURBEHIND bb = { 0 };

		// Enable Blur Behind and apply to the entire client area
		bb.dwFlags = DWM_BB_ENABLE;
		bb.fEnable = enable;
		bb.hRgnBlur = NULL;

		const HRESULT returnValue = DwmEnableBlurBehindWindow(handle, &bb);

		return SUCCEEDED(returnValue) ? 0 : 1;
	}
	else if (blurtype == ACRYLIC_BLUR) {
		const HINSTANCE hModule = LoadLibrary(TEXT("user32.dll"));
		int result = 1;
		if (hModule) {
			typedef BOOL(WINAPI*pSetWindowCompositionAttribute)(HWND,
				WINCOMPATTRDATA*);
			const pSetWindowCompositionAttribute
				SetWindowCompositionAttribute =
				(pSetWindowCompositionAttribute)GetProcAddress(
					hModule,
					"SetWindowCompositionAttribute");

			// Only works on Win10
			if (SetWindowCompositionAttribute) {
				ACCENTPOLICY policy = 
					{ enable ? ACCENT_ENABLE_ACRYLIC
						: ACCENT_DISABLE , 2, ((UINT)(opacity * 255.0) << 24) | color, 0 };
				WINCOMPATTRDATA data = { 19, &policy, sizeof(ACCENTPOLICY) };
				if (SetWindowCompositionAttribute(handle, &data))
					result = 0;
				else
					result = 1;
			}
			FreeLibrary(hModule);
			return result;
		}
	}
}
