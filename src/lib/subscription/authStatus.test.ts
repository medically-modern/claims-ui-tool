import { describe, expect, it } from "vitest";
import { AUTH_OK, renderAuth } from "./authStatus";

describe("renderAuth", () => {
  it("passes every label the backend's gate passes", () => {
    for (const l of ["Auth Valid", "Not Serving", "No Auth Needed"]) {
      expect(renderAuth([l]).tone).toBe("ok");
      expect(AUTH_OK.has(l)).toBe(true);
    }
  });

  it("renders Required as amber — an auth we owe, not one we were refused", () => {
    // The board writes this to every Medicaid patient the moment their order
    // goes out, so it is the resting state of 263 of 264 active Medicaid rows.
    expect(renderAuth(["Required"])).toEqual({ tone: "warn", label: "Required" });
  });

  it("renders Evaluate and Auth. Expiring as amber too", () => {
    expect(renderAuth(["Evaluate"]).tone).toBe("warn");
    expect(renderAuth(["Auth. Expiring"]).tone).toBe("warn");
  });

  it("renders a refusal or a lapse as red", () => {
    for (const l of ["Auth. Expired", "Auth Expired", "Denied"]) {
      expect(renderAuth([l]).tone).toBe("bad");
    }
  });

  it("renders Submitted as grey — waiting on the payer, not on us", () => {
    expect(renderAuth(["Submitted"]).tone).toBe("pending");
  });

  it("renders no value at all as an open circle, not a pass or a fail", () => {
    expect(renderAuth([])).toEqual({ tone: "pending", unknown: true, label: "Not set" });
    expect(renderAuth(["", "  "])).toMatchObject({ unknown: true });
  });

  describe("two served categories", () => {
    it("is green only when both sides are clear", () => {
      expect(renderAuth(["Auth Valid", "No Auth Needed"]).tone).toBe("ok");
    });
    it("takes the worse of the two", () => {
      expect(renderAuth(["Auth Valid", "Required"]).tone).toBe("warn");
      expect(renderAuth(["Required", "Denied"]).tone).toBe("bad");
      expect(renderAuth(["Auth Valid", "Auth. Expired"]).tone).toBe("bad");
    });
    it("is only grey when BOTH sides are waiting on the payer", () => {
      expect(renderAuth(["Submitted", "Submitted"]).tone).toBe("pending");
      expect(renderAuth(["Submitted", "Required"]).tone).toBe("warn");
    });
    it("shows the board's own words, joined", () => {
      expect(renderAuth(["Not Serving", "Required"]).label).toBe("Not Serving / Required");
    });
  });
});
