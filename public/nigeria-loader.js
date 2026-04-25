(function () {
  var NS = "http://www.w3.org/2000/svg";
  var FB = [
    [2.69, 6.26],
    [2.74, 7.87],
    [2.85, 9.04],
    [3.55, 11.66],
    [3.9, 12.4],
    [4.29, 13.1],
    [5.42, 13.86],
    [6.82, 13.32],
    [7.32, 13.1],
    [8.5, 13.3],
    [9.75, 13.1],
    [11.05, 13.39],
    [12.3, 13.2],
    [13.1, 13.45],
    [14.07, 13.08],
    [14.59, 12.85],
    [14.63, 11.7],
    [14.18, 11.24],
    [13.57, 10.8],
    [13.4, 10.2],
    [13.04, 9.64],
    [12.83, 8.94],
    [12.37, 8.3],
    [11.94, 7.78],
    [11.5, 6.9],
    [10.84, 6.82],
    [10.1, 6.82],
    [9.5, 6.45],
    [9.05, 6.13],
    [8.57, 5.06],
    [8.13, 4.66],
    [7.4, 4.4],
    [6.7, 4.3],
    [6.0, 4.3],
    [5.3, 4.86],
    [4.4, 5.4],
    [3.6, 5.2],
    [3.0, 5.5],
    [2.69, 6.26],
  ];

  function mkProj(feats, sz, pad) {
    var xn = 1 / 0,
      xx = -1 / 0,
      yn = 1 / 0,
      yx = -1 / 0;
    function each(g, fn) {
      if (!g) return;
      var R =
        g.type === "Polygon"
          ? g.coordinates
          : g.type === "MultiPolygon"
            ? g.coordinates.reduce(function (a, p) {
                return a.concat(p);
              }, [])
            : [];
      R.forEach(function (r) {
        r.forEach(fn);
      });
    }
    feats.forEach(function (f) {
      each(f.geometry, function (c) {
        if (c[0] < xn) xn = c[0];
        if (c[0] > xx) xx = c[0];
        if (c[1] < yn) yn = c[1];
        if (c[1] > yx) yx = c[1];
      });
    });
    var lat0 = (yn + yx) / 2,
      kx = Math.cos((lat0 * Math.PI) / 180),
      w = (xx - xn) * kx,
      h = yx - yn,
      u = sz - pad * 2,
      sc = Math.min(u / w, u / h),
      cx = sz / 2,
      cy = sz / 2,
      mx = (xn + xx) / 2,
      my = (yn + yx) / 2;
    return function (c) {
      return [cx + (c[0] - mx) * kx * sc, cy - (c[1] - my) * sc];
    };
  }
  function r2p(ring, proj) {
    var d = "";
    for (var i = 0; i < ring.length; i++) {
      var p = proj(ring[i]);
      d += (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2);
    }
    return d + "Z";
  }
  function g2p(g, proj) {
    if (!g) return "";
    var R =
      g.type === "Polygon"
        ? g.coordinates
        : g.type === "MultiPolygon"
          ? g.coordinates.reduce(function (a, p) {
              return a.concat(p);
            }, [])
          : [];
    return R.map(function (r) {
      return r2p(r, proj);
    }).join(" ");
  }

  function render(feats) {
    var proj = mkProj(feats, 200, 18);
    var xn = 1 / 0,
      xx = -1 / 0,
      yn = 1 / 0,
      yx = -1 / 0;
    var paths = feats.map(function (f) {
      if (f.geometry) {
        var R =
          f.geometry.type === "Polygon"
            ? f.geometry.coordinates
            : f.geometry.type === "MultiPolygon"
              ? f.geometry.coordinates.reduce(function (a, p) {
                  return a.concat(p);
                }, [])
              : [];
        R.forEach(function (r) {
          r.forEach(function (c) {
            var p = proj(c);
            if (p[0] < xn) xn = p[0];
            if (p[0] > xx) xx = p[0];
            if (p[1] < yn) yn = p[1];
            if (p[1] > yx) yx = p[1];
          });
        });
      }
      return g2p(f.geometry, proj);
    });
    var cp = document.getElementById("nldr-cp"),
      mg = document.getElementById("nldr-map");
    if (!cp || !mg) return;
    while (cp.firstChild) cp.removeChild(cp.firstChild);
    while (mg.firstChild) mg.removeChild(mg.firstChild);
    paths.forEach(function (d) {
      var el = document.createElementNS(NS, "path");
      el.setAttribute("d", d);
      cp.appendChild(el);
    });
    var sw = (xx - xn) / 3,
      yA = yn - 2,
      hA = yx - yn + 4;
    var sg = document.createElementNS(NS, "g");
    sg.setAttribute("clip-path", "url(#nldr-cp)");
    [
      [xn, "#008753"],
      [xn + sw, "#FFFFFF"],
      [xn + 2 * sw, "#008753"],
    ].forEach(function (pair) {
      var r = document.createElementNS(NS, "rect");
      r.setAttribute("x", pair[0]);
      r.setAttribute("y", yA);
      r.setAttribute("width", sw);
      r.setAttribute("height", hA);
      r.setAttribute("fill", pair[1]);
      sg.appendChild(r);
    });
    mg.appendChild(sg);
    paths.forEach(function (d) {
      var el = document.createElementNS(NS, "path");
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", "#008753");
      el.setAttribute("stroke-opacity", "0.55");
      el.setAttribute("stroke-width", "0.55");
      el.setAttribute("stroke-linejoin", "round");
      el.setAttribute("vector-effect", "non-scaling-stroke");
      mg.appendChild(el);
    });
    paths.forEach(function (d) {
      var el = document.createElementNS(NS, "path");
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", "#008753");
      el.setAttribute("stroke-width", "0.9");
      el.setAttribute("stroke-linejoin", "round");
      el.setAttribute("vector-effect", "non-scaling-stroke");
      mg.appendChild(el);
    });
  }

  // Render fallback silhouette immediately
  render([{ geometry: { type: "Polygon", coordinates: [FB] } }]);

  // Try CDN for real state outlines (upgrades the fallback if fetch succeeds)
  var SRCS = [
    "https://cdn.jsdelivr.net/gh/iamspruce/intro-d3@main/data/nigeria_state_boundaries.geojson",
    "https://cdn.statically.io/gh/iamspruce/intro-d3/main/data/nigeria_state_boundaries.geojson",
  ];
  (function tryFetch(i) {
    if (i >= SRCS.length) return;
    fetch(SRCS[i], { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw 0;
        return r.json();
      })
      .then(function (d) {
        if (d && d.features && d.features.length) render(d.features);
      })
      .catch(function () {
        tryFetch(i + 1);
      });
  })(0);

  // Self-remove when React mounts
  var root = document.getElementById("root");
  if (root)
    new MutationObserver(function (_, obs) {
      if (root.children.length) {
        var ldr = document.getElementById("nldr");
        if (ldr) {
          ldr.classList.add("nldr-out");
          setTimeout(function () {
            ldr.parentNode && ldr.parentNode.removeChild(ldr);
          }, 400);
        }
        obs.disconnect();
      }
    }).observe(root, { childList: true });
})();
