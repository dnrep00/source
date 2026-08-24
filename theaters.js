/*
 * CGV 극장 코드 데이터 (지역 → 극장)
 *
 * 출처: CGV_극장코드.xlsx ('전체' 시트)
 *
 * 이 파일은 브라우저(public/index.html)와 Node.js 서버(server.js)에서
 * 함께 사용한다.
 *   - 브라우저: <script src="theaters.js"> 로 로드 → 전역 CGV_REGIONS 사용
 *   - 서버:     require("./public/theaters.js") → { CGV_REGIONS, ... } 사용
 */

const CGV_REGIONS = [

  {
    region: "서울",
    theaters: [
      { name: "강남", code: "0056" },
      { name: "강변", code: "0001" },
      { name: "건대입구", code: "0229" },
      { name: "고덕강일", code: "0366" },
      { name: "구로", code: "0010" },
      { name: "대학로", code: "0063" },
      { name: "동대문", code: "0252" },
      { name: "등촌", code: "0230" },
      { name: "명동", code: "0009" },
      { name: "미아", code: "0057" },
      { name: "방학", code: "0288" },
      { name: "불광", code: "0030" },
      { name: "상봉", code: "0046" },
      { name: "성신여대입구", code: "0300" },
      { name: "수유", code: "0276" },
      { name: "신촌아트레온", code: "0150" },
      { name: "씨네드쉐프 압구정", code: "P001" },
      { name: "씨네드쉐프 용산", code: "P013" },
      { name: "압구정", code: "0040" },
      { name: "여의도", code: "0112" },
      { name: "연남", code: "0292" },
      { name: "영등포타임스퀘어", code: "0059" },
      { name: "왕십리", code: "0074" },
      { name: "용산아이파크몰", code: "0013" },
      { name: "중계", code: "0131" },
      { name: "천호", code: "0199" },
      { name: "청담씨네시티", code: "0107" },
      { name: "피카디리1958", code: "0223" },
      { name: "홍대", code: "0191" }
    ]
  },

  {
    region: "경기",
    theaters: [
      { name: "Drive In 용인 크랙사이드", code: "0365" },
      { name: "경기광주", code: "0260" },
      { name: "고양백석", code: "0270" },
      { name: "고양행신", code: "0374" },
      { name: "광교", code: "0257" },
      { name: "광교상현", code: "0266" },
      { name: "광명역", code: "0348" },
      { name: "구리", code: "0232" },
      { name: "구리갈매", code: "0358" },
      { name: "기흥", code: "0344" },
      { name: "김포", code: "0278" },
      { name: "김포운양", code: "0188" },
      { name: "김포한강", code: "0298" },
      { name: "남양주화도", code: "0329" },
      { name: "다산", code: "0351" },
      { name: "동두천", code: "0236" },
      { name: "동백", code: "0124" },
      { name: "동수원", code: "0041" },
      { name: "동탄", code: "0106" },
      { name: "동탄그랑파사쥬", code: "0359" },
      { name: "동탄역", code: "0265" },
      { name: "동탄호수공원", code: "0233" },
      { name: "배곧", code: "0226" },
      { name: "범계", code: "0155" },
      { name: "부천", code: "0015" },
      { name: "부천역", code: "0194" },
      { name: "산본", code: "0242" },
      { name: "서현", code: "0196" },
      { name: "소풍", code: "0143" },
      { name: "스타필드시티위례", code: "0274" },
      { name: "신세계경기", code: "0055" },
      { name: "안산", code: "0211" },
      { name: "안성", code: "0279" },
      { name: "야탑", code: "0003" },
      { name: "양주옥정", code: "0262" },
      { name: "역곡", code: "0338" },
      { name: "오리", code: "0004" },
      { name: "오산중앙", code: "0307" },
      { name: "용인", code: "0271" },
      { name: "의정부", code: "0113" },
      { name: "이천", code: "0205" },
      { name: "일산", code: "0054" },
      { name: "파주문산", code: "0148" },
      { name: "파주운정", code: "0371" },
      { name: "판교", code: "0181" },
      { name: "평촌", code: "0195" },
      { name: "평택", code: "0052" },
      { name: "평택고덕", code: "0334" },
      { name: "평택소사", code: "0214" },
      { name: "포천", code: "0309" },
      { name: "화성봉담", code: "0301" },
      { name: "화정", code: "0145" }
    ]
  },

  {
    region: "인천",
    theaters: [
      { name: "계양", code: "0043" },
      { name: "부평", code: "0021" },
      { name: "송도타임스페이스", code: "0325" },
      { name: "인천", code: "0002" },
      { name: "인천가정", code: "0296" },
      { name: "인천도화", code: "0340" },
      { name: "인천시민공원", code: "0352" },
      { name: "인천연수", code: "0258" },
      { name: "인천학익", code: "0269" },
      { name: "주안역", code: "0308" },
      { name: "청라", code: "0235" }
    ]
  },

  {
    region: "강원",
    theaters: [
      { name: "강릉", code: "0139" },
      { name: "기린", code: "0355" },
      { name: "원통", code: "0354" },
      { name: "인제", code: "0281" },
      { name: "춘천", code: "0070" }
    ]
  },

  {
    region: "대전/충청",
    theaters: [
      { name: "논산", code: "0370" },
      { name: "당진", code: "0207" },
      { name: "대전", code: "0007" },
      { name: "대전가수원", code: "0286" },
      { name: "대전가오", code: "0154" },
      { name: "대전탄방", code: "0202" },
      { name: "대전터미널", code: "0127" },
      { name: "서산", code: "0091" },
      { name: "세종", code: "0219" },
      { name: "아산", code: "0356" },
      { name: "유성노은", code: "0206" },
      { name: "천안", code: "0369" },
      { name: "천안터미널", code: "0293" },
      { name: "천안펜타포트", code: "0110" },
      { name: "청주(서문)", code: "0228" },
      { name: "청주지웰시티", code: "0142" },
      { name: "청주터미널", code: "0319" },
      { name: "충북혁신", code: "0284" },
      { name: "충주교현", code: "0328" },
      { name: "홍성", code: "0217" }
    ]
  },

  {
    region: "대구",
    theaters: [
      { name: "대구", code: "0345" },
      { name: "대구수성", code: "0375" },
      { name: "대구스타디움", code: "0108" },
      { name: "대구연경", code: "0343" },
      { name: "대구월성", code: "0216" },
      { name: "대구죽전", code: "0256" },
      { name: "대구한일", code: "0147" },
      { name: "대구현대", code: "0109" }
    ]
  },

  {
    region: "부산/울산",
    theaters: [
      { name: "Drive In 영도", code: "0367" },
      { name: "대연", code: "0061" },
      { name: "동래", code: "0042" },
      { name: "부산명지", code: "0337" },
      { name: "서면", code: "0005" },
      { name: "서면삼정타워", code: "0285" },
      { name: "서면상상마당", code: "0303" },
      { name: "센텀시티", code: "0089" },
      { name: "씨네드쉐프 센텀", code: "P004" },
      { name: "아시아드", code: "0160" },
      { name: "울산동구", code: "0335" },
      { name: "울산삼산", code: "0128" },
      { name: "울산성남", code: "0333" },
      { name: "울산신천", code: "0264" },
      { name: "울산진장", code: "0246" },
      { name: "정관", code: "0306" },
      { name: "하단아트몰링", code: "0245" },
      { name: "해운대", code: "0318" }
    ]
  },

  {
    region: "경상",
    theaters: [
      { name: "거제", code: "0263" },
      { name: "경산", code: "0330" },
      { name: "고성", code: "0323" },
      { name: "구미", code: "0053" },
      { name: "김천율곡", code: "0240" },
      { name: "김해", code: "0028" },
      { name: "김해율하", code: "0311" },
      { name: "김해장유", code: "0239" },
      { name: "마산", code: "0033" },
      { name: "북포항", code: "0097" },
      { name: "안동", code: "0272" },
      { name: "양산삼호", code: "0234" },
      { name: "진주혁신", code: "0324" },
      { name: "창원더시티", code: "0079" },
      { name: "창원상남", code: "0283" }
    ]
  },

  {
    region: "광주/전라/제주",
    theaters: [
      { name: "광양", code: "0220" },
      { name: "광양 엘에프스퀘어", code: "0221" },
      { name: "광주금남로", code: "0295" },
      { name: "광주상무", code: "0193" },
      { name: "광주용봉", code: "0210" },
      { name: "광주첨단", code: "0218" },
      { name: "광주충장로", code: "0244" },
      { name: "광주하남", code: "0215" },
      { name: "나주", code: "0237" },
      { name: "목포평화광장", code: "0280" },
      { name: "서전주", code: "0225" },
      { name: "순천신대", code: "0268" },
      { name: "여수웅천", code: "0315" },
      { name: "익산", code: "0020" },
      { name: "전주고사", code: "0213" },
      { name: "전주에코시티", code: "0336" },
      { name: "전주효자", code: "0179" },
      { name: "정읍", code: "0186" },
      { name: "제주", code: "0302" },
      { name: "제주노형", code: "0259" }
    ]
  }

];


/*
 * 기본 선택 극장: 경기 - 오리 (0004)
 */
const CGV_DEFAULT_REGION = "경기";
const CGV_DEFAULT_SITE_NO = "0004";


/*
 * Node.js(server.js)에서 require 할 때만 export.
 * 브라우저에서는 module 이 정의되어 있지 않으므로 무시된다.
 */
if (typeof module !== "undefined" && module.exports) {

  module.exports = {
    CGV_REGIONS,
    CGV_DEFAULT_REGION,
    CGV_DEFAULT_SITE_NO
  };

}
