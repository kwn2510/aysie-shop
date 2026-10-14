const scripts = ['js/shop.js', 'js/product.js', 'js/main.js'];
let scriptIndex = 0;

function loadNextScript() {
	if (scriptIndex >= scripts.length) return;
	const script = document.createElement('script');
	script.src = scripts[scriptIndex++];
	script.onload = loadNextScript;
	document.body.appendChild(script);
}

loadNextScript();