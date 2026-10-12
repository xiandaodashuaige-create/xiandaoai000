"""Edge TTS with an offline Windows SAPI fallback.

Usage: python tts_edge.py <text file> <voice> <rate> <output mp3> <output json>
"""
import asyncio
import json
import os
import re
import subprocess
import sys

import edge_tts


def offline_sapi(text_file, voice, rate, out_mp3, out_json):
    wav = os.path.splitext(out_mp3)[0] + ".fallback.wav"
    sapi_voice = "Microsoft Zira Desktop" if voice.lower().startswith("en-") else "Microsoft Huihui Desktop"
    rate_value = max(-10, min(10, round(int(re.sub(r"[^0-9-]", "", rate) or "0") / 4)))
    esc = lambda value: str(value).replace("'", "''")
    script = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('{esc(sapi_voice)}')
$s.Rate = {rate_value}
$s.SetOutputToWaveFile('{esc(wav)}')
$s.Speak([IO.File]::ReadAllText('{esc(text_file)}',[Text.Encoding]::UTF8))
$s.Dispose()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "2", out_mp3], check=True)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out_mp3],
        check=True, capture_output=True, text=True,
    )
    duration = max(.1, float(probe.stdout.strip()))
    text = open(text_file, encoding="utf-8").read().strip()
    tokens = re.findall(r"[A-Za-z0-9']+|[\u3400-\u9fff]", text) or [text]
    total = sum(max(1, len(token)) for token in tokens)
    cursor, words = 0.0, []
    for token in tokens:
        span = duration * max(1, len(token)) / total
        words.append({"text": token, "start": cursor, "end": min(duration, cursor + span)})
        cursor += span
    with open(out_json, "w", encoding="utf-8") as handle:
        json.dump(words, handle, ensure_ascii=False)
    if os.path.exists(wav):
        os.remove(wav)


async def main():
    text_file, voice, rate, out_mp3, out_json = sys.argv[1:6]
    text = open(text_file, encoding="utf-8").read().strip()
    words = []
    try:
        comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        with open(out_mp3, "wb") as handle:
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    handle.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    words.append({
                        "text": chunk["text"],
                        "start": chunk["offset"] / 1e7,
                        "end": (chunk["offset"] + chunk["duration"]) / 1e7,
                    })
        if not os.path.exists(out_mp3) or os.path.getsize(out_mp3) < 1000:
            raise RuntimeError("Edge TTS returned no usable audio")
        with open(out_json, "w", encoding="utf-8") as handle:
            json.dump(words, handle, ensure_ascii=False)
    except Exception as error:
        print(f"edge_tts_failed; using offline SAPI fallback: {error}", file=sys.stderr)
        if os.path.exists(out_mp3):
            os.remove(out_mp3)
        offline_sapi(text_file, voice, rate, out_mp3, out_json)


asyncio.run(main())
