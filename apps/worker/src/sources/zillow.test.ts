import { describe, expect, it } from "vitest";
import { parseZillow } from "./zillow.ts";

// Same shape as Zillow's search __NEXT_DATA__ (listResults); values are made up.
function page(listResults: object[]) {
  const data = {
    props: {
      pageProps: {
        searchPageState: {
          cat1: { searchResults: { listResults }, searchList: { totalPages: 2 } },
        },
      },
    },
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
}

const unit = {
  zpid: "1",
  detailUrl: "/homedetails/1-example/1_zpid/",
  address: "1 Example St #801, Toronto, ON M5V 1A1",
  unformattedPrice: 2600,
  beds: 1,
  baths: 1,
  latLong: { latitude: 43.64, longitude: -79.39 },
  imgSrc: "https://photos.zillowstatic.com/fp/1-p_e.jpg",
};
const big = "https://photos.zillowstatic.com/fp/1-cc_ft_960.jpg";

describe("parseZillow", () => {
  it("keeps the card's cover photo link on every row, units of a building too", () => {
    const building = {
      ...unit,
      zpid: "2",
      unformattedPrice: undefined,
      buildingName: "The Example",
      units: [
        { price: "$2,100+", beds: "0" },
        { price: "$2,700+", beds: "1" },
      ],
    };
    const { listings, totalPages } = parseZillow(page([unit, building]));
    expect(totalPages).toBe(2);
    // The card's ~600 px photo, asked for at 960 px.
    expect(listings.map((l) => l.imageUrl)).toEqual(Array(3).fill(big));
    expect(parseZillow(page([{ ...unit, imgSrc: null }])).listings[0].imageUrl).toBeNull();
  });
});
