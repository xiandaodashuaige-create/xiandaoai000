/* 鹿联AI广告 — shared landing behaviors */
(function(){
  const WA_NUMBER = "60106519843";
  document.documentElement.classList.add("js");
  // Build a wa.me url with a prefilled message. data-wa-msg on a link overrides default.
  window.waLink = function(msg){
    return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg || "");
  };

  document.addEventListener("DOMContentLoaded", function(){
    // Wire any [data-wa] element to open WhatsApp with its message
    document.querySelectorAll("[data-wa]").forEach(function(el){
      const msg = el.getAttribute("data-wa-msg") || el.closest("[data-wa-msg]")?.getAttribute("data-wa-msg") || "";
      const href = window.waLink(msg);
      // Fire Meta Pixel conversion (Lead) on tap so campaigns can optimize for leads
      const fireLead = function(){
        try{ if(typeof fbq === "function"){ fbq("track","Lead",{content_name:"WhatsApp 免费诊断"}); } }catch(e){}
      };
      if(el.tagName === "A"){ el.href = href; el.target="_blank"; el.rel="noopener"; el.addEventListener("click", fireLead); }
      else { el.addEventListener("click", function(){ fireLead(); window.open(href, "_blank","noopener"); }); el.style.cursor="pointer"; }
    });

    // Sticky bottom CTA: reveal after user scrolls past hero
    const sticky = document.querySelector(".sticky-cta");
    const hero = document.querySelector("[data-hero-end]") || document.querySelector(".hero");
    if(sticky){
      const onScroll = function(){
        const trigger = hero ? hero.getBoundingClientRect().bottom < 40 : window.scrollY > 360;
        sticky.classList.toggle("show", trigger);
      };
      window.addEventListener("scroll", onScroll, {passive:true});
      onScroll();
    }

    // Floating bubble: show after slight scroll
    const fab = document.querySelector(".fab");
    if(fab){
      const onScroll2 = function(){ fab.style.opacity = window.scrollY > 220 ? "1":"0"; fab.style.pointerEvents = window.scrollY>220?"auto":"none"; };
      fab.style.transition="opacity .3s ease"; fab.style.opacity="0";
      window.addEventListener("scroll", onScroll2, {passive:true}); onScroll2();
    }

    // Reveal on scroll — scroll-based (robust across embedded iframes)
    const reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    function checkReveals(){
      const vh = window.innerHeight || document.documentElement.clientHeight;
      for(let i=reveals.length-1;i>=0;i--){
        const el = reveals[i];
        if(el.getBoundingClientRect().top < vh*0.9){ el.classList.add("in"); reveals.splice(i,1); }
      }
    }
    window.addEventListener("scroll", checkReveals, {passive:true});
    window.addEventListener("resize", checkReveals, {passive:true});
    checkReveals();
    // safety: never leave content hidden
    setTimeout(function(){ document.querySelectorAll(".reveal").forEach(function(el){ el.classList.add("in"); }); }, 2500);

    // Animated count-up for [data-count] — scroll-based trigger
    const counters = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
    function runCount(el){
      const end = parseFloat(el.getAttribute("data-count"));
      const dec = (el.getAttribute("data-dec")|0);
      const pre = el.getAttribute("data-pre")||""; const suf=el.getAttribute("data-suf")||"";
      const dur = 1400; const t0 = performance.now();
      function tick(t){
        const p = Math.min(1,(t-t0)/dur); const eased = 1-Math.pow(1-p,3);
        const v = end*eased;
        el.textContent = pre + v.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}) + suf;
        if(p<1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    function checkCounts(){
      const vh = window.innerHeight || document.documentElement.clientHeight;
      for(let i=counters.length-1;i>=0;i--){
        const el = counters[i];
        if(el.getBoundingClientRect().top < vh*0.85){ runCount(el); counters.splice(i,1); }
      }
    }
    window.addEventListener("scroll", checkCounts, {passive:true});
    checkCounts();

    // Live-ish quota ticker (just visual): decrement slowly within a floor
    document.querySelectorAll("[data-quota]").forEach(function(el){
      let n = parseInt(el.textContent,10)||7;
      setInterval(function(){
        if(n>3 && Math.random()<0.5){ n--; el.textContent=n; el.animate([{transform:"scale(1.3)"},{transform:"scale(1)"}],{duration:300}); }
      }, 9000);
    });
  });
})();
