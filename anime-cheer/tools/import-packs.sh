#!/bin/sh
# Builds the sprite packs the stage draws from sheets you downloaded yourself.
#
#   sh tools/import-packs.sh [folder with your downloaded sheets]
#
# The folder defaults to ~/Downloads. Sheets that are not there are skipped.
# The packs stay on your machine (.gitignore keeps them out of git): game
# sprites belong to their publishers, so don't commit or share them.
set -e
cd "$(dirname "$0")/.."
SHEETS="${1:-$HOME/Downloads}"

# Each block names the file it wants and where it comes from.
want() {
  if [ -f "$SHEETS/$1" ]; then
    return 0
  fi
  echo "skip $2: put \"$1\" in $SHEETS to add her"
  return 1
}

# 不知火舞 · The Spriters Resource: Mobile / Metal Slug Defense / Units / Mai Shiranui
F="Mobile - Metal Slug Defense - Units_ The King of Fighters - Mai Shiranui.png"
if want "$F" mai; then
  bun tools/import-pack.ts mai "$SHEETS/$F" --cells 00ff00 --key ff00ff --scale 1 --sample mode --wide \
    --anims '{"idle":[0,1,2,3,4,5,6,7,8,9,10],"walk":[11,12,13,14,15,16,17,18],"dance":[41,42,43,44,44,43,42,41,90,91,92,93,94,95,96,97,98,98,98,50,51,52,53,54],"cheer":[90,91,92,93,94,95,96,97,98,98,98,98],"attack":[19,20,21,22,23,24,25,26,27,28,29,71,72,73,74,0],"sleep":[120]}'
fi

# 小舞 · The Spriters Resource: Mobile / Senran no Samurai Kingdom / Mai Shiranui
F="Mobile - Senran no Samurai Kingdom (JPN) - Characters - The King of Fighters - Mai Shiranui.png"
if want "$F" maiq; then
  bun tools/import-pack.ts maiq "$SHEETS/$F" --scale 0.75 --sample mode --wide \
    --anims '{"idle":[0,1,2,3],"walk":[15,16,17,18,19,20,21],"dance":[6,7,6,7,0,1,6,7,8,8,0,1],"cheer":[6,7,6,7],"attack":[4,8,9,9,10,10,0],"sleep":[14]}'
fi

# 塞拉菲娜 · The Spriters Resource: Nintendo Switch / Disgaea 5 Complete / Seraphina (Bunny Girl)
F="Nintendo Switch - Disgaea 5 Complete - Characters - Seraphina (Bunny Girl).png"
if want "$F" bunny; then
  bun tools/import-pack.ts bunny "$SHEETS/$F" --cells 1b5999 --key 93bbec --scale 0.2 --sample mode --wide --facing left \
    --anims '{"idle":[0,1,2,3,4,5],"walk":[24,25,26,27,28,29],"dance":[196,197,198,199,200,201,202,203,205,206,207,208,209,210,211,212],"cheer":[216,217,218,219,220,221,222,223,224,225,226,227,228,229],"attack":[145,146,147,148,149,150,151,152,168,169,170,171,172,173,174],"sleep":[234]}'
fi

# 卡蜜拉 · CraftPix "Free Vampire Pixel Art Sprite Sheets": unzip it into the folder
V="$SHEETS/Countess_Vampire"
if want "Countess_Vampire/Idle.png" countess; then
  bun tools/import-pack.ts countess "$V/Idle.png" "$V/Walk.png" "$V/Attack_1.png" "$V/Attack_4.png" "$V/Jump.png" "$V/Dead.png" \
    --grid 128x128 --scale 0.5 --sample mode --wide \
    --anims '{"idle":[0,1,2,3,4],"walk":[5,6,7,8,9,10],"dance":[0,0,1,1,2,2,3,3,4,4],"cheer":[23,24,25,26,27,28],"attack":[11,12,13,14,15,16,17,18,19,20,21,22],"sleep":[36]}'
fi
