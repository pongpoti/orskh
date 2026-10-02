/** Non-interactive parts of the operating suite plan. */
export function FloorScenery() {
  return (
    <>
      <defs>
        <pattern id="fp-grate" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect className="fp-grate-base" width="16" height="16" />
          <path className="fp-grate-line" d="M16 0H0V16" />
        </pattern>
      </defs>
      <rect className="fp-bg" x="20" y="20" width="1167" height="1666" />
      <path id="zone-outer" className="fp-zone-outer" d="M45 971L45 859L594 859L594 994L507 994L507 1096L427 1096L427 971Z" />
      <path id="fp-shell" className="fp-shell" d="M20 1686L20 1622L1187 1622L1187 1686ZM20 1686L20 1325L102 1325L102 1686ZM20 1325L20 619L45 619L45 1325ZM20 619L20 20L122 20L122 619ZM20 619L20 553L332 553L332 619ZM20 66L20 20L1187 20L1187 66ZM1113 1686L1113 20L1187 20L1187 1686Z" />
      <g id="fp-grates">
        <rect className="fp-grate-block" x="120" y="259" width="62" height="104" />
        <rect className="fp-grate-block" x="572" y="70" width="100" height="53" />
        <rect className="fp-grate-block" x="1067" y="375" width="58" height="94" />
        <rect className="fp-grate-block" x="1027" y="857" width="82" height="89" />
        <rect className="fp-grate-block" x="571" y="1552" width="95" height="66" />
      </g>
      <g id="fp-support">
        <g id="room-plant" className="fp-support"><path className="fp-floor" d="M318 1326L318 1096L517 1096L517 1326Z" /><path className="fp-wall fp-thin" d="M318 1326L318 1096L517 1096L517 1326Z" /></g>
        <g id="room-core-stair" className="fp-support"><path className="fp-floor" d="M517 1326L517 1096L642 1096L642 1326Z" /><path className="fp-wall fp-thin" d="M517 1326L517 1096L642 1096L642 1326Z" /></g>
        <g id="room-svc-a" className="fp-support"><path className="fp-floor" d="M642 1326L642 1212L787 1212L787 1326Z" /><path className="fp-wall fp-thin" d="M642 1326L642 1212L787 1212L787 1326Z" /></g>
        <g id="room-svc-b" className="fp-support"><path className="fp-floor" d="M642 1212L642 1096L787 1096L787 1212Z" /><path className="fp-wall fp-thin" d="M642 1212L642 1096L787 1096L787 1212Z" /></g>
        <g id="room-lobby-annex" className="fp-support"><path className="fp-floor" d="M507 1096L507 994L652 994L652 1096Z" /><path className="fp-wall fp-thin" d="M507 1096L507 994L652 994L652 1096Z" /></g>
        <g id="room-util-w" className="fp-support"><path className="fp-floor" d="M912 1547L912 1412L1109 1412L1109 1547Z" /><path className="fp-wall fp-thin" d="M912 1547L912 1412L1109 1412L1109 1547Z" /></g>
        <g id="room-store-w" className="fp-support"><path className="fp-floor" d="M909 1412L909 1328L1109 1328L1109 1412Z" /><path className="fp-wall fp-thin" d="M909 1412L909 1328L1109 1328L1109 1412Z" /></g>
        <g id="room-svc-8-7" className="fp-support"><path className="fp-floor" d="M909 946L909 857L1027 857L1027 946Z" /><path className="fp-wall fp-thin" d="M909 946L909 857L1027 857L1027 946Z" /></g>
        <g id="room-shaft-7-6" className="fp-support"><path className="fp-floor" d="M909 705L909 673L1109 673L1109 705Z" /><path className="fp-wall fp-thin" d="M909 705L909 673L1109 673L1109 705Z" /></g>
        <g id="room-stair-e" className="fp-support"><path className="fp-floor" d="M529 859L529 699L677 699L677 859Z" /><path className="fp-wall fp-thin" d="M529 859L529 699L677 699L677 859Z" /></g>
        <g id="room-svc-lift" className="fp-support"><path className="fp-floor" d="M203 827L203 763L387 763L387 827Z" /><path className="fp-wall fp-thin" d="M203 827L203 763L387 763L387 827Z" /></g>
        <g id="room-svc-pocket" className="fp-support"><path className="fp-floor" d="M182 363L182 259L327 259L327 363Z" /><path className="fp-wall fp-thin" d="M182 363L182 259L327 259L327 363Z" /></g>
      </g>
      <g id="fp-cores">
        <g id="lift-bank-west" className="fp-core" data-zone="2"><path className="fp-floor" d="M51 1090L51 971L427 971L427 1090Z" /><path className="fp-detail" d="M145 1090L145 971M239 1090L239 971M333 1090L333 971" /><path className="fp-cab" d="M65 1078L65 983L131 983L131 1078ZM159 1078L159 983L225 983L225 1078ZM253 1078L253 983L319 983L319 1078ZM347 1078L347 983L413 983L413 1078Z" /><path className="fp-wall fp-thin" d="M51 1090L51 971L427 971L427 1090Z" /></g>
        <g id="lift-bank-east" className="fp-core" data-zone="1"><path className="fp-floor" d="M198 763L198 602L333 602L333 763Z" /><path className="fp-detail" d="M198 682.5L333 682.5" /><path className="fp-cab" d="M208 753L208 688.5L323 688.5L323 753ZM208 676.5L208 612L323 612L323 676.5Z" /><path className="fp-wall fp-thin" d="M198 763L198 602L333 602L333 763Z" /></g>
        <g id="stair-north" className="fp-core"><path className="fp-floor" d="M35 827L35 705L177 705L177 827Z" /><path className="fp-detail" d="M49 820L49 794M49 738L49 712M58 820L58 794M58 738L58 712M67 820L67 794M67 738L67 712M76 820L76 794M76 738L76 712M85 820L85 794M85 738L85 712M94 820L94 794M94 738L94 712M103 820L103 794M103 738L103 712M112 820L112 794M112 738L112 712M121 820L121 794M121 738L121 712M130 820L130 794M130 738L130 712M139 820L139 794M139 738L139 712M148 820L148 794M148 738L148 712M157 820L157 794M157 738L157 712M49 794L49 738L163 738L163 794Z" /><path className="fp-wall fp-thin" d="M35 827L35 705L177 705L177 827Z" /></g>
        <g id="stair-southwest" className="fp-core"><path className="fp-floor" d="M975 1672L975 1552L1139 1552L1139 1672Z" /><path className="fp-detail" d="M989 1665L989 1618M989 1606L989 1559M998 1665L998 1618M998 1606L998 1559M1007 1665L1007 1618M1007 1606L1007 1559M1016 1665L1016 1618M1016 1606L1016 1559M1025 1665L1025 1618M1025 1606L1025 1559M1034 1665L1034 1618M1034 1606L1034 1559M1043 1665L1043 1618M1043 1606L1043 1559M1052 1665L1052 1618M1052 1606L1052 1559M1061 1665L1061 1618M1061 1606L1061 1559M1070 1665L1070 1618M1070 1606L1070 1559M1079 1665L1079 1618M1079 1606L1079 1559M1088 1665L1088 1618M1088 1606L1088 1559M1097 1665L1097 1618M1097 1606L1097 1559M1106 1665L1106 1618M1106 1606L1106 1559M1115 1665L1115 1618M1115 1606L1115 1559M1124 1665L1124 1618M1124 1606L1124 1559M989 1618L989 1606L1125 1606L1125 1618Z" /><path className="fp-wall fp-thin" d="M975 1672L975 1552L1139 1552L1139 1672Z" /></g>
        <g id="stair-southeast" className="fp-core"><path className="fp-floor" d="M972 132L972 27L1139 27L1139 132Z" /><path className="fp-detail" d="M986 125L986 85.5M986 73.5L986 34M995 125L995 85.5M995 73.5L995 34M1004 125L1004 85.5M1004 73.5L1004 34M1013 125L1013 85.5M1013 73.5L1013 34M1022 125L1022 85.5M1022 73.5L1022 34M1031 125L1031 85.5M1031 73.5L1031 34M1040 125L1040 85.5M1040 73.5L1040 34M1049 125L1049 85.5M1049 73.5L1049 34M1058 125L1058 85.5M1058 73.5L1058 34M1067 125L1067 85.5M1067 73.5L1067 34M1076 125L1076 85.5M1076 73.5L1076 34M1085 125L1085 85.5M1085 73.5L1085 34M1094 125L1094 85.5M1094 73.5L1094 34M1103 125L1103 85.5M1103 73.5L1103 34M1112 125L1112 85.5M1112 73.5L1112 34M1121 125L1121 85.5M1121 73.5L1121 34M986 85.5L986 73.5L1125 73.5L1125 85.5Z" /><path className="fp-wall fp-thin" d="M972 132L972 27L1139 27L1139 132Z" /></g>
        <g id="stair-core" className="fp-core"><path className="fp-floor" d="M539 1249L539 1129L633 1129L633 1249Z" /><path className="fp-detail" d="M543 1240L629 1240M543 1230L629 1230M543 1220L629 1220M543 1210L629 1210M543 1200L629 1200M543 1190L629 1190M543 1180L629 1180M543 1170L629 1170M543 1160L629 1160M543 1150L629 1150M543 1140L629 1140" /><path className="fp-wall fp-thin" d="M539 1249L539 1129L633 1129L633 1249Z" /></g>
        <g id="stair-core-east" className="fp-core"><path className="fp-floor" d="M537 853L537 805L593 805L593 853Z" /><path className="fp-detail" d="M541 844L589 844M541 834L589 834M541 824L589 824M541 814L589 814" /><path className="fp-wall fp-thin" d="M537 853L537 805L593 805L593 853Z" /></g>
      </g>
      <g id="lobby-walls"><path className="fp-wall" d="M594 994L594 967M594 917L594 859M429 859L529 859" /></g>
      <g id="reception-counter" className="fp-counter"><path className="fp-counter-top" d="M49 868L49 850L180 850L180 868ZM214 868L214 850L346 850L346 868ZM380 868L380 850L429 850L429 868Z" /></g>
    </>
  );
}
