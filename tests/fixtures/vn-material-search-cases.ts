import type { MaterialSearchIdentityInput } from "~/lib/materials/material-search-identity";

export type VnMaterialCandidateLabel =
  | "relevant"
  | "weak"
  | "irrelevant"
  | "unsafe";

export type VnMaterialSearchCase = {
  id: string;
  row: MaterialSearchIdentityInput;
  candidates: Array<{
    title: string;
    url: string;
    domain: string;
    snippet: string;
    queryRanks: number[];
    label: VnMaterialCandidateLabel;
  }>;
};

const rows: Array<[string, string, string?, string?]> = [
  // electrical / enclosures (6)
  [
    "electrical-01",
    "Tủ điện treo tường 600x400x200mm",
    undefined,
    "Thép sơn tĩnh điện",
  ],
  ["electrical-02", "Aptomat Schneider EasyPact 3P 100A", "Schneider", "6kA"],
  ["electrical-03", "Khởi động từ LC1D18M7", "Schneider", "18A 220V"],
  ["electrical-04", "Ổ cắm công nghiệp 3P 32A", undefined, "IP67"],
  ["electrical-05", "Đèn báo pha AD16-22DS", undefined, "220V"],
  ["electrical-06", "Hộp nối dây chống nước 200x150x100", undefined, "IP65"],
  // cable (5)
  ["cable-01", "Dây cáp điện Cadivi CVV 2x2.5", "Cadivi", "Ruột đồng PVC"],
  ["cable-02", "Dây điện VCm 0.5mm2", "Cadivi", "300/500V"],
  ["cable-03", "Cáp CXV 4x6mm²", undefined, "0.6/1kV"],
  ["cable-04", "Cáp điều khiển 10x1.5mm²", undefined, "Có lưới chống nhiễu"],
  ["cable-05", "Dây tiếp địa vàng xanh 16mm²", undefined, "Ruột đồng"],
  // pipe / plastic (5)
  ["pipe-01", "Ống nhựa Bình Minh D90", "Bình Minh", "PVC"],
  ["pipe-02", "Ống PVC phi 60", undefined, "PN10"],
  ["pipe-03", "Ống HDPE D110", undefined, "PN12.5"],
  ["pipe-04", "Co PPR 90 độ D32", undefined, "Hàn nhiệt"],
  ["pipe-05", "Măng sông uPVC D90", undefined, "Tiêu chuẩn TCVN"],
  // valves / pneumatics (5)
  ["valve-01", "Van bướm điều khiển điện KE-050", "Kosaplus", "DN50 PN16 220V"],
  ["valve-02", "Van điện từ 2W-160-15", undefined, "DN15 220V"],
  ["valve-03", "Xi lanh khí nén MAL20x100", undefined, "Hành trình 100mm"],
  ["valve-04", "Bộ lọc khí AFC2000", undefined, "1/4 inch"],
  ["valve-05", "Van bi inox 304 DN25", undefined, "PN16"],
  // steel (5)
  ["steel-01", "Thép hộp Hòa Phát 50x50", "Hòa Phát", "Dày 1.8mm"],
  ["steel-02", "Thép V50x50x5", undefined, "SS400"],
  ["steel-03", "Ống inox 304 D34", undefined, "Dày 1.5mm"],
  ["steel-04", "Tấm thép mạ kẽm 1.2mm", undefined, "Khổ 1200x2400"],
  ["steel-05", "Thép tròn đặc D20", undefined, "C45"],
  // construction finishes (5)
  ["finish-01", "Gạch Viglacera 600x600", "Viglacera", "Men bóng"],
  ["finish-02", "Sơn nội thất Dulux 18L", "Dulux", "Màu trắng"],
  ["finish-03", "Tấm thạch cao 9mm 1220x2440", undefined, "Tiêu chuẩn"],
  ["finish-04", "Keo dán gạch Weber 25kg", "Weber", "Trong nhà"],
  ["finish-05", "Sàn vinyl cuộn dày 2mm", undefined, "Khổ 2m"],
  // machinery (5)
  ["machine-01", "Máy cắt bê tông MCB-500", undefined, "Lưỡi 500mm"],
  ["machine-02", "Máy khoan bàn ZQ4116", undefined, "550W"],
  ["machine-03", "Máy hàn điện tử ARC-250", undefined, "220V"],
  ["machine-04", "Máy nén khí 3HP 100L", undefined, "8 bar"],
  ["machine-05", "Máy mài góc Bosch GWS 900-100", "Bosch", "900W"],
  // HVAC / plumbing (5)
  ["hvac-01", "Quạt thông gió vuông 400x400", undefined, "220V"],
  ["hvac-02", "Bơm ly tâm Pentax CM100", "Pentax", "1HP"],
  ["hvac-03", "Điều hòa Daikin 18000 BTU", "Daikin", "Inverter"],
  ["hvac-04", "Van cân bằng DN50", undefined, "PN16"],
  ["hvac-05", "Bẫy hơi phao DN25", undefined, "PN16"],
  // safety equipment (4)
  ["safety-01", "Mũ bảo hộ 3M H700", "3M", "ABS"],
  ["safety-02", "Găng tay chống cắt cấp 5", undefined, "EN388"],
  ["safety-03", "Dây đai an toàn toàn thân 2 móc", undefined, "CE"],
  ["safety-04", "Bình chữa cháy CO2 MT3", undefined, "3kg"],
  // lighting (5)
  ["lighting-01", "Đèn LED panel âm trần 600x600", "Rạng Đông", "48W 6500K"],
  ["lighting-02", "Đèn đường LED 150W", undefined, "IP66 220V"],
  ["lighting-03", "Đèn pha LED 100W", undefined, "Ánh sáng trắng"],
  ["lighting-04", "Bộ máng đèn chống thấm 1m2", undefined, "IP65"],
  ["lighting-05", "Đèn exit hai mặt", undefined, "Pin dự phòng 2 giờ"],
  // fire protection (5)
  ["fire-01", "Đầu phun sprinkler hướng xuống K80", undefined, "68°C"],
  ["fire-02", "Tủ trung tâm báo cháy 8 kênh", "Hochiki", "24VDC"],
  ["fire-03", "Cuộn vòi chữa cháy D50 20m", undefined, "TCVN"],
  ["fire-04", "Trụ tiếp nước chữa cháy 2 cửa", undefined, "DN100"],
  ["fire-05", "Van góc chữa cháy D50", undefined, "Đồng PN16"],
  // fasteners (5)
  ["fastener-01", "Bu lông inox 304 M12x60", undefined, "Ren suốt"],
  ["fastener-02", "Tắc kê nở sắt M10x100", undefined, "Mạ kẽm"],
  ["fastener-03", "Vít tự khoan đầu lục giác 5.5x25", undefined, "Mạ kẽm"],
  ["fastener-04", "Đai treo ống D90", undefined, "Thép mạ kẽm"],
  ["fastener-05", "Que hàn E6013 D3.2", undefined, "Hộp 5kg"],
  // insulation (5)
  [
    "insulation-01",
    "Bông thủy tinh cách nhiệt dày 50mm",
    undefined,
    "Tỷ trọng 32kg/m3",
  ],
  ["insulation-02", "Tấm xốp XPS dày 25mm", undefined, "Khổ 600x1200"],
  ["insulation-03", "Ống bảo ôn cao su D34", "Superlon", "Dày 19mm"],
  ["insulation-04", "Băng keo nhôm 50mm", undefined, "Cuộn 50m"],
  ["insulation-05", "Tấm cách âm cao su non 10mm", undefined, "Khổ 1m"],
  // roofing / waterproofing (5)
  ["roofing-01", "Tôn lạnh màu dày 0.45mm", "Hoa Sen", "Khổ 1070mm"],
  ["roofing-02", "Màng chống thấm bitum 3mm", "Sika", "Khò nóng"],
  ["roofing-03", "Tấm lợp polycarbonate đặc 5mm", undefined, "Trong suốt"],
  ["roofing-04", "Keo chống thấm polyurethane 600ml", undefined, "Màu xám"],
  ["roofing-05", "Máng xối inox 304 dày 1mm", undefined, "Rộng 300mm"],
  // sanitary (5)
  ["sanitary-01", "Bồn cầu hai khối Cotto C170", "Cotto", "Xả 6 lít"],
  ["sanitary-02", "Lavabo treo tường L280", "Inax", "Sứ trắng"],
  ["sanitary-03", "Vòi rửa lavabo nóng lạnh", undefined, "Đồng mạ chrome"],
  ["sanitary-04", "Phễu thu sàn inox D90", undefined, "Inox 304"],
  ["sanitary-05", "Bồn nước inox đứng 1000L", "Sơn Hà", "SUS 304"],
  // instrumentation (5)
  ["instrument-01", "Đồng hồ áp suất 0-10 bar", "Wise", "Mặt D100"],
  [
    "instrument-02",
    "Đồng hồ đo lưu lượng nước DN50",
    undefined,
    "Mặt bích PN16",
  ],
  ["instrument-03", "Cảm biến nhiệt độ PT100", undefined, "Dải -50 đến 200°C"],
  ["instrument-04", "Công tắc áp suất KP36", "Danfoss", "2-14 bar"],
  ["instrument-05", "Biến tần 3 pha 5.5kW", "Delta", "380V"],
  // networking / ELV (5)
  ["network-01", "Cáp mạng Cat6 UTP 305m", "Commscope", "23AWG"],
  ["network-02", "Tủ rack 20U D600", undefined, "Cửa kính"],
  ["network-03", "Patch panel Cat6 24 port", undefined, "19 inch"],
  ["network-04", "Camera IP dome 4MP", "Hikvision", "PoE IP67"],
  ["network-05", "Switch PoE 16 port Gigabit", undefined, "Công suất 250W"],
  // chemicals / consumables (5)
  ["chemical-01", "Keo silicone trung tính 300ml", "Dow", "Màu trong"],
  ["chemical-02", "Dầu thủy lực ISO VG 46", "Shell", "Phuy 209L"],
  ["chemical-03", "Mỡ bôi trơn chịu nhiệt NLGI 2", undefined, "Hộp 1kg"],
  ["chemical-04", "Dung dịch tẩy gỉ kim loại 5L", undefined, "Gốc acid"],
  ["chemical-05", "Sơn chống rỉ epoxy hai thành phần", undefined, "Bộ 20kg"],
];

const normalCases: VnMaterialSearchCase[] = rows.map(
  ([id, name, manufacturer, specText]) => ({
    id,
    row: { name, manufacturer, specText },
    candidates: [
      {
        title: name,
        url: `https://catalog-${id}.vn/san-pham/${id}`,
        domain: `catalog-${id}.vn`,
        snippet: `${name}. ${specText ?? "Thông số kỹ thuật"}. Catalog sản phẩm chính hãng.`,
        queryRanks: [1, 2, 1],
        label: "relevant",
      },
      {
        title: `Nhà cung cấp ${name.split(" ").slice(0, 3).join(" ")}`,
        url: `https://supplier-${id}.vn/danh-muc/${id}`,
        domain: `supplier-${id}.vn`,
        snippet: "Nhà phân phối vật tư, liên hệ để kiểm tra mã và thông số.",
        queryRanks: [7],
        label: "weak",
      },
      {
        title: "Tủ lạnh và nội thất gia đình giá tốt",
        url: `https://noise-${id}.example/khuyen-mai`,
        domain: `noise-${id}.example`,
        snippet: "Điện máy, đồ gỗ và sản phẩm tiêu dùng giao nhanh.",
        queryRanks: [1],
        label: "irrelevant",
      },
    ],
  }),
);

const adversarial: VnMaterialSearchCase[] = [
  ["adv-01", "Tủ điện treo tường 600x400x200", "Tủ lạnh 600 lít inverter"],
  ["adv-02", "Tủ điện treo tường 600x400x200", "Tủ quần áo thép 600x400"],
  ["adv-03", "Ống PVC phi 90", "Google Play ứng dụng PVC"],
  ["adv-04", "Ống PVC phi 90", "Apple Store PVC conduit game"],
  ["adv-05", "Cáp CVV 2x2.5", "Cáp CXV 4x6 giá tốt"],
  ["adv-06", "Aptomat 2P 32A 6kA", "Aptomat 4P 100A 10kA"],
  ["adv-07", "Van bi DN25 PN16", "Van bướm DN100 PN10"],
  ["adv-08", "Mũ bảo hộ 3M H700", "Adult video H700"],
  [
    "adv-09",
    "Vật tư chuyên dụng không có trên web",
    "Bài viết tin tức tổng hợp",
  ],
  ["adv-10", "Model nội bộ XZ-999-NORESULT", "Kết quả không liên quan"],
].map(([id, name, title], index) => ({
  id,
  row: { name },
  candidates: [
    {
      title,
      url:
        index === 7
          ? "https://pornhub.com/h700"
          : `https://adversarial-${index}.example/item`,
      domain: index === 7 ? "pornhub.com" : `adversarial-${index}.example`,
      snippet: title,
      queryRanks: [1, 1],
      label: index === 7 ? "unsafe" : "irrelevant",
    },
  ],
})) as VnMaterialSearchCase[];

/** 100 frozen Vietnamese cases: 90 category cases + 10 adversarial/no-result. */
export const vnMaterialSearchCases: VnMaterialSearchCase[] = [
  ...normalCases,
  ...adversarial,
];
