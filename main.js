//デモ用。trueならウェブカメラではなくmp4を入力にする
const DEBUG_DEMO_MP4 = false;
//trueなら検出された顔の上にランドマークやボックスを描画する
//また、trueの場合にワーカスレッド側で画像処理されていたらそれを表示する
const DEBUG_DRAW_FACE = true;

//モデルの位置
const posX = 0;
const posY = -1.1;
const posZ = -1.5;
//モデルのサイズ
const scale = 1;

let renderer, scene, camera;
let body, webcam, input, inputCtx, output, outputCtx;
let loading, message, width, height, webcamLongSide = 512;

//FPS表示用（メインスレッド側。ワーカスレッド側の速度ではないので注意）
let stats = new Stats();
stats.dom.style.display = "none";
document.body.appendChild(stats.dom);

//THREEのレンダラの初期化
const initRenderer = async () => {
	//z-fighting対策でlogarithmicDepthBufferを指定
	renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: true });
	renderer.gammaOutput = true;
	renderer.setClearColor(new THREE.Color(0xffffff), 0);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.domElement.style.position = "absolute";
	renderer.domElement.style.top = "0px";
	renderer.domElement.style.left = "0px";
	document.body.appendChild(renderer.domElement);
}
//THREEのシーンの初期化
const initScene = async () => {
	//シーンの作成
	scene = new THREE.Scene();

	//カメラの作成、シーンへの追加
	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
	camera.position.set(0, 0, 0);
	scene.add(camera);

	//ライトの作成、シーンへの追加
	let light = new THREE.AmbientLight(0xffffff, 1.0);
	scene.add(light);

	//VRMモデルの読み込み
	let result = await loadModel();

	return result;
}

//モデルデータ
let dst = {};

//VRMモデルの読み込み
const loadModel = async () => {
	//vrmファイルの読み込み
	let vrmLoader = new THREE.VRMLoader();
	let result = await new Promise(resolve => {
		vrmLoader.load("assets/VRoid.vrm", (vrm) => {
			vrm.scene.position.set(posX, posY, posZ);
			vrm.scene.scale.set(scale, scale, scale);
			vrm.scene.rotation.set(0.0, Math.PI, 0.0);

			// VRMLoader doesn't support VRM Unlit extension yet so
			// converting all materials to MeshBasicMaterial here as workaround so far.
			vrm.scene.traverse((object) => {
				if(!object.material){ return; }

				if(Array.isArray(object.material)){
					for(let i = 0, il = object.material.length; i < il; i ++){
						let material = new THREE.MeshBasicMaterial();
						THREE.Material.prototype.copy.call(material, object.material[i]);
						material.color.copy(object.material[i].color);
						material.map = object.material[i].map;
						material.lights = false;
						material.skinning = object.material[i].skinning;
						material.morphTargets = object.material[i].morphTargets;
						material.morphNormals = object.material[i].morphNormals;
						object.material[i] = material;
					}
				}else{
					let material = new THREE.MeshBasicMaterial();
					THREE.Material.prototype.copy.call(material, object.material);
					material.color.copy(object.material.color);
					material.map = object.material.map;
					material.lights = false;
					material.skinning = object.material.skinning;
					material.morphTargets = object.material.morphTargets;
					material.morphNormals = object.material.morphNormals;
					object.material = material;
				}
			});

			//ボーンの取得
			dst["position"]  = vrm.scene.getObjectByName("Position");
			dst["neck"]      = vrm.scene.getObjectByName("J_Bip_C_Neck");
			dst["head"]      = vrm.scene.getObjectByName("J_Bip_C_Head");
			dst["upperArmL"] = vrm.scene.getObjectByName("J_Bip_L_UpperArm");
			dst["upperArmR"] = vrm.scene.getObjectByName("J_Bip_R_UpperArm");

			//モーフターゲットの取得
			dst["face"]      = vrm.scene.getObjectByName("Face", true);

			//Tポーズのままだと何なので腕は下げておく
			let quat = new THREE.Quaternion();
			let euler = new THREE.Euler(0, 0, Math.PI / 2, "XYZ");
			quat.setFromEuler(euler);
			dst["upperArmL"].rotation.setFromQuaternion(quat);
			euler = new THREE.Euler(0, 0, -Math.PI / 2, "XYZ");
			quat.setFromEuler(euler);
			dst["upperArmR"].rotation.setFromQuaternion(quat);

			//シーンへのモデルの追加
			scene.add(vrm.scene);

			//読み込み失敗か、カメラから外れているだけかの切り分け用
			//camera.lookAt(vrm.scene.position);

			return resolve(vrm.scene);
		});
	});

	return result;
}
//ウェブカメラの初期化
const initWebcam = async () => {
	body = document.createElement("body")
	webcam = document.getElementById("webcam");
	input = document.createElement("canvas");
	inputCtx = input.getContext("2d");
	output = document.getElementById("canvas");
	outputCtx = output.getContext('2d');
	message = document.getElementById("message");
	loading = document.getElementById("loading");

	if(DEBUG_DEMO_MP4){
		//デバッグ用。mp4からの入力
		webcam.src = "test.mp4";
		webcam.loop = true;
	}else{
		//ウェブカメラからの入力
		navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
		const stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: "user" },
			audio: false

		});
		webcam.srcObject = stream;
	}
	webcam.play();

	window.onresize = resize;
	resize();
}
//ブラウザのリサイズ時の処理
//※とりあえずキャンバスはブラウザのアスペクト比に倣う
const resize = () => {
	let w = window.innerWidth;
	let h = window.innerHeight;
	if(window.innerWidth > window.innerHeight){
		width = webcamLongSide;
		height = Math.floor(webcamLongSide * h / w);
	}else{
		width = Math.floor(webcamLongSide * w / h);
		height = webcamLongSide;
	}
	webcam.width = input.width = output.width = width;
	webcam.height = input.height = output.height = height;
}

//各初期化処理が終わったら更新処理を開始する
let initWorker = false;
const init = async () => {
	let resWebcam = initWebcam();
	let resRenderer = initRenderer();
	let resScene = initScene();

	//ウェブカメラ、レンダラ、シーンの初期化が済んでいるか
	await Promise.all([resWebcam, resRenderer, resScene]);

	//ワーカの初期化も済んでいるか
	await new Promise(resolve => {
		setInterval(() => {
			if(initWorker){ resolve() }
		}, 100);
	});

	stats.dom.style.display = "block";

	//ウェブカメラの映像をバッファに描いてワーカスレッドに送る
	inputCtx.drawImage(webcam, 0, 0, width, height);
	let buffer = inputCtx.getImageData(0, 0, width, height).data.buffer;
	worker.postMessage({ type: "detect", buffer: buffer, width: width, height: height }, [buffer]); 

	//更新処理の開始
	requestAnimationFrame(update);
}
//更新処理
const update = async () => {
	requestAnimationFrame(update);

	//シーンの描画
	renderer.render(scene, camera);
	//FPSの更新
	stats.update();
}

//初期化処理の開始
init();

//顔の上にランドマークを描画する
//https://ibug.doc.ic.ac.uk/resources/facial-point-annotations/
const drawLandmark = (context, landmark) => {
	outputCtx.strokeStyle = "rgb(255, 0, 0)";
	context.beginPath();
	context.moveTo(landmark[0].x, landmark[0].y);
	for(let i = 1; i < 17; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.moveTo(landmark[17].x, landmark[17].y);
	for(let i = 18; i < 22; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.moveTo(landmark[22].x, landmark[22].y);
	for(let i = 22; i < 27; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.moveTo(landmark[27].x, landmark[27].y);
	for(let i = 28; i < 31; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.moveTo(landmark[31].x, landmark[31].y);
	for(let i = 32; i < 36; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.moveTo(landmark[36].x, landmark[36].y);
	for(let i = 37; i < 42; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.lineTo(landmark[36].x, landmark[36].y);
	context.moveTo(landmark[42].x, landmark[42].y);
	for(let i = 43; i < 48; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.lineTo(landmark[42].x, landmark[42].y);
	context.moveTo(landmark[48].x, landmark[48].y);
	for(let i = 49; i < 59; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.lineTo(landmark[48].x, landmark[48].y);
	context.moveTo(landmark[60].x, landmark[60].y);
	for(let i = 61; i < 68; i++){ context.lineTo(landmark[i].x, landmark[i].y); }
	context.lineTo(landmark[60].x, landmark[60].y);
	context.closePath();
	context.stroke();
}
//顔の上にボックスを描画する
const drawBox = (context, pose) => {
	outputCtx.strokeStyle = "rgb(0, 255, 0)";
	context.beginPath();
	context.moveTo(pose[0].x, pose[0].y);
	context.lineTo(pose[2].x, pose[2].y);
	context.lineTo(pose[4].x, pose[4].y);
	context.lineTo(pose[6].x, pose[6].y);
	context.lineTo(pose[0].x, pose[0].y);

	context.moveTo(pose[1].x, pose[1].y);
	context.lineTo(pose[3].x, pose[3].y);
	context.lineTo(pose[5].x, pose[5].y);
	context.lineTo(pose[7].x, pose[7].y);
	context.lineTo(pose[1].x, pose[1].y);
	context.closePath();
	context.stroke();

	outputCtx.strokeStyle = "rgb(0, 0, 255)";
	context.beginPath();
	context.moveTo(pose[0].x, pose[0].y);
	context.lineTo(pose[1].x, pose[1].y);
	context.moveTo(pose[2].x, pose[2].y);
	context.lineTo(pose[3].x, pose[3].y);
	context.moveTo(pose[4].x, pose[4].y);
	context.lineTo(pose[5].x, pose[5].y);
	context.moveTo(pose[6].x, pose[6].y);
	context.lineTo(pose[7].x, pose[7].y);
	context.closePath();
	context.stroke();
}

const deg2rad = (deg) => { return deg * Math.PI / 180.0; }
const rad2deg = (rad) => { return rad * 180.0 / Math.PI; }
const clamp = (val) => { return Math.min(Math.max(0, val), 1); }

let maxEyeL = 0, minEyeL = 10000;
let maxEyeR = 0, minEyeR = 10000;
let maxMouthH = 0, minMouthH = 10000;

const worker = new Worker("worker.js");
worker.addEventListener("message", (msg) => {
	switch(msg.data.type){
	case "locateFile": {
		message.innerText = "ロード中...";
		break;
	}
	case "preRun": {
		message.innerText = "コンパイル中...";
		break;
	}
	case "postRun": {
		message.innerText = "";
		loading.style.display = "none";
		initWorker = true;
		break;
	}
	case "detect": {
		let rects = msg.data.faces;
		let direction = msg.data.direction;
		let landmarks = msg.data.landmarks;
		let boxes = msg.data.boxes;
		let angles = msg.data.angles;

		let current = 0;
		//デモ用。一番左の人を追跡する
		if(DEBUG_DEMO_MP4){
			current = -1;
			let currentNose = webcamLongSide;
			for (let i = 0; i < landmarks.length; i++) {
				const landmark = landmarks[i];
				if(landmark[31].x > (webcamLongSide / 2)){ continue; }
				if(currentNose > landmark[31].x){ 
					currentNose = landmark[31].x; 
					current = i;
				}
			}
		}

		//モデルに位置と首の傾きを反映
		if(current >= 0 && angles.length > 0){ 
			const angle = angles[current];
			let quat = new THREE.Quaternion();
			let pitch = -angle["pitch"];
			let yaw   = -angle["yaw"];
			let roll  = -angle["roll"];
			let euler = new THREE.Euler(pitch, yaw, pitch, "XYZ");
			quat.setFromEuler(euler);
			dst["neck"].rotation.setFromQuaternion(quat);

			let x =  angle["x"] * 0.0001;
			let y =  angle["y"] * 0.0001;
			let z = -angle["z"] * 0.0001;
			dst["position"].position.set(x, y, z);
		}
		//モデルに表情を反映
		if(current >= 0 && landmarks.length > 0){ 
			const landmark = landmarks[current];

			//表情指定の番号（morphTargetInfluences[N]）
			//
			//   怒 楽 喜 悲 驚 両 右 左 喜右 喜左 上 下 通 あ い う え お ＞＜
			//基  0  1  2  3  4
			//眉  5  6  7  8  9
			//目 10 17 14 17 18 11 12 13   15   16
			//口 22 24 25 26 27                    20 21 23 28 29 30 31 32 [19+39]
			//
			//   両 下 上 両 下 上
			//歯 33 34 35 36 37 38

			let eyeL = (landmark[46].y + landmark[47].y) - (landmark[43].y + landmark[44].y);
			let eyeR = (landmark[40].y + landmark[41].y) - (landmark[37].y + landmark[38].y);
			let mouthH = landmark[66].y - landmark[62].y;

			//過去の最小値から最大値の範囲（0～1）に対して現在値がどれくらいかを指定する
			//※あまり良い方法ではないので別のやりかたが思い付いたら変更する
			maxEyeL = Math.max(eyeL, maxEyeL);
			minEyeL = Math.min(eyeL, minEyeL);
			maxEyeR = Math.max(eyeR, maxEyeR);
			minEyeR = Math.min(eyeR, minEyeR);
			//※目は閉じるほど1に近付くので注意
			eyeL = (maxEyeL - eyeL) / (maxEyeL - minEyeL);
			eyeR = (maxEyeR - eyeR) / (maxEyeR - minEyeR);
			eyeL = clamp(eyeL);
			eyeR = clamp(eyeR);

			maxMouthH = Math.max(mouthH, maxMouthH);
			minMouthH = Math.min(mouthH, minMouthH);
			mouthH = (mouthH - minMouthH) / (maxMouthH - minMouthH);
			mouthH = clamp(mouthH);

			dst["face"].morphTargetInfluences[15] = eyeR;
			dst["face"].morphTargetInfluences[16] = eyeL;
			dst["face"].morphTargetInfluences[25] = mouthH;
		}

		//デバッグ用
		if(DEBUG_DRAW_FACE){
			const rectColor = ["rgb(0, 0, 255)", "rgb(255, 0, 255)", "rgb(0, 255, 255)", "rgb(255, 255, 0)"];

			let buffer = msg.data.buffer;
			let channels = msg.data.channels;
			let width = msg.data.width;
			let height = msg.data.height;

			//ワーカスレッドから送られてきた画像をキャンバスに描画
			const imgData = outputCtx.createImageData(width, height);
			for(let i = 0, j = 0; i < buffer.length; i += channels, j += 4){
				imgData.data[j] = buffer[i];
				imgData.data[j + 1] = buffer[i + 1 % channels];
				imgData.data[j + 2] = buffer[i + 2 % channels];
				imgData.data[j + 3] = 255;
			}
			outputCtx.putImageData(imgData, 0, 0);
			outputCtx.lineWidth = 2;


			//デモ用。追跡している人に黄色い枠を付ける
			if(DEBUG_DEMO_MP4){
				if(current >= 0){
					let face = rects[current];
					outputCtx.strokeStyle = "rgb(255, 255, 0)";
					outputCtx.strokeRect(face.x, face.y, face.width, face.height);
				}
			}

			for (let i = 0; i < rects.length; i++) {
				//顔の矩形の描画
				//let face = rects[i];
				//outputCtx.strokeStyle = rectColor[direction];
				//outputCtx.strokeRect(face.x, face.y, face.width, face.height);

				//ランドマークの描画
				if(landmarks.length <= i){ continue; }
				const landmark = landmarks[i];
				drawLandmark(outputCtx, landmark);

				//ボックスの描画
				if(boxes.length <= i){ continue; }
				const box = boxes[i];
				drawBox(outputCtx, box);
			}
		}else{
			outputCtx.drawImage(webcam, 0, 0, width, height);
		}

		//ワーカスレッド側に画像を送る
		inputCtx.drawImage(webcam, 0, 0, width, height);
		let buffer = inputCtx.getImageData(0, 0, width, height).data.buffer;
		worker.postMessage({ type: "detect", buffer, width, height }, [buffer]); 

		break;
	}
	}

});
