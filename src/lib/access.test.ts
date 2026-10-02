import assert from "node:assert/strict";
import { test } from "node:test";
import { accessRedirect } from "./access.ts";

test("sends a new LINE user to registration and a registered user past it", () => {
  assert.equal(
    accessRedirect({ loggedIn: true, allowed: true, registered: false, pathname: "/" }),
    "/register",
  );
  assert.equal(
    accessRedirect({ loggedIn: true, allowed: true, registered: false, pathname: "/register" }),
    null,
  );
  assert.equal(
    accessRedirect({ loggedIn: true, allowed: true, registered: true, pathname: "/register" }),
    "/",
  );
  assert.equal(
    accessRedirect({ loggedIn: true, allowed: true, registered: true, pathname: "/" }),
    null,
  );
});

test("keeps guests on the login page and blocked accounts on pending", () => {
  assert.equal(
    accessRedirect({ loggedIn: false, allowed: false, registered: false, pathname: "/login" }),
    null,
  );
  assert.equal(
    accessRedirect({ loggedIn: false, allowed: false, registered: false, pathname: "/" }),
    "/login",
  );
  assert.equal(
    accessRedirect({ loggedIn: true, allowed: false, registered: false, pathname: "/register" }),
    "/pending",
  );
});
