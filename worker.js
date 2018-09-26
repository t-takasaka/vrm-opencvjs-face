//trueならDNN、falseならカスケード型分類器を顔領域の検出に使用
//※DNNは正確だが重い。カスケード型分類器は速いが横顔の精度が低く、正面顔も口を開けると精度が落ちる
const isDNN = true;
//trueならHaar-Like特徴（明暗差）、falseならLBP特徴（輝度分布）をカスケード型分類器で使用
//※顔領域の検出にDNNを使う場合はこのフラグは無視される
const isHaar = true;
//trueならLBF、falseならKazemiをランドマークの検出に使用
//※KazemiはDlibと同じアルゴリズムのはずだが精度が上がらない。パラメータ周りの検証が必要
const isLBF = true;

let classifierFront;
let classifierProf;
let net;
let facemark;

let Module = {
	locateFile: (name) => {
		//wasmの指定
		let files = { "opencv_js.wasm": "opencv_js.wasm" }
		self.postMessage({ type: "locateFile" });

		return files[name]
	},
	preRun: () => {
		const dir = "assets/";

		//ランドマークの特徴量
		const landmark = isLBF ? "lbfmodel.yaml" : "face_landmark_model.dat";
		Module.FS_createPreloadedFile("/", "landmark", dir + landmark, true, false);

		if(isDNN){
			//DNNのモデルとウェイト
			Module.FS_createPreloadedFile("/", "proto", dir + "face_detector.prototxt", true, false);
			Module.FS_createPreloadedFile("/", "model", dir + "face_detector.caffemodel", true, false);
		}else{
			//カスケード型分類器の特徴量
			const cascadeFront = isHaar ? "haarcascade_frontalface_default.xml" : "lbpcascade_frontalface_improved.xml";
			Module.FS_createPreloadedFile("/", "cascadeFront", dir + cascadeFront, true, false);
			const cascadeProf = isHaar ? "haarcascade_profileface.xml" : "lbpcascade_profileface.xml";
			Module.FS_createPreloadedFile("/", "cascadeProf", dir + cascadeProf, true, false);
		}

		self.postMessage({ type: "preRun" });
	},
	postRun: () => {
		//ランドマークの読み込み
		facemark = isLBF ? cv.createFacemarkLBF() : cv.createFacemarkKazemi();
		facemark.loadModel("landmark");

		if(isDNN){
			//DNNの読み込み
			net = cv.readNetFromCaffe1("proto", "model");
		}else{
			//カスケード型分類器の読み込み
			classifierFront = new cv.CascadeClassifier();
			classifierFront.load("cascadeFront");
			classifierProf = new cv.CascadeClassifier();
			classifierProf.load("cascadeProf");
		}

		//console.log(cv);

		self.postMessage({ type: "postRun" });
	},
	noImageDecoding: true,
};

//前フレームとの平均を取ってカク付きを減らすための変数
let oldRects = undefined;
let oldLandmarks = undefined;
let oldRotate = undefined;
let oldTranslate = undefined;

self.importScripts("opencv.js");
self.addEventListener("message", async (msg) =>{

	//グレースケール
	const cvtGray = (gray) => {
		cv.cvtColor(gray, gray, cv.COLOR_RGBA2GRAY);
		//適用的ヒストグラム平坦化
		let clahe = new cv.CLAHE();
		clahe.setClipLimit(1);
		clahe.apply(gray, gray);
		clahe.delete();
	}
	//顔領域の検出
	const getRect = (gray, rects) => {
		const scaleFactor = 1.1; //1.1
		const minNeighbors = 3; //3
		const minScale = 0.3;
		const minSize = new cv.Size(gray.cols * minScale, gray.rows * minScale);
		let maxArea = 0;

		//正面顔
		const getRectFront = () => {
			classifierFront.detectMultiScale(gray, rects, scaleFactor, minNeighbors, 0, minSize);
			for(let i = 0; i < rects.size(); i++){
				let rect = rects.get(i);
				let area = rect.width * rect.height;
				if(area > maxArea){ maxArea = area; }
			}

			return rects.size();
		}
		//横顔
		const getRectProf = (flip) => {
			//カスケードデータが右向きにしか対応してないので反転
			if(flip){ cv.flip(gray, gray, 1); }

			let _rects = new cv.RectVector();
			classifierProf.detectMultiScale(gray, _rects, scaleFactor, minNeighbors, 0, minSize);

			//大きい領域が取れていたら入れ替え
			//※現状だと前段で検出できていないのが確定している（rectsが空）のでこの処理だと冗長
			for(let i = 0; i < _rects.size(); i++){
				let rect = _rects.get(i);
				let area = rect.width * rect.height;
				if(area <= maxArea){ continue; }

				maxArea = area; 
				rects.resize(0, new cv.Rect());
				for(let j = 0; j < _rects.size(); j++){
					let tmp = _rects.get(j);

					//横顔は若干大きめに検出されるので調整
					//データを作り直した方がよさそう
					const scale = 0.775;
					tmp.width *= scale;
					tmp.height *= scale;
					tmp.y += tmp.height * 0.175;

					//x座標を反転
					if(flip){ tmp.x = gray.cols - tmp.x - tmp.width; }
					rects.push_back(tmp);
				}
				break;
			}
			_rects.delete();

			return rects.size();
		}

		//正面
		let size = getRectFront();
		if(size > 0){ return 0; }
		//右向き
		size = getRectProf(false);
		if(size > 0){ return 1; }
		//左向き
		size = getRectProf(true);
		if(size > 0){ return 2; }

		return -1;
	}
	const getRectDNN = (img, rects) => {
		//DNNは動作速度的に128pxくらいが限界
		const scale = 128 / Math.max(img.cols, img.rows);
		let bgr = img.clone();
		cv.resize(bgr, bgr, { width: bgr.cols * scale, height: bgr.rows * scale} );
		cv.cvtColor(bgr, bgr, cv.COLOR_RGBA2BGR);
		let size = { width: bgr.cols, height: bgr.rows };

		//平均値。出所は下記
		//https://github.com/opencv/opencv/tree/master/samples/dnn
		//To achieve the best accuracy run the model on BGR images resized to 300x300 
		//applying mean subtraction of values (104, 177, 123) for each blue, green and red channels correspondingly.
		let mean = [104, 177, 123, 0];

		let blob = cv.blobFromImage(bgr, 1, size, mean, false, false);
		net.setInput(blob);
		let rect = net.forward();

		const scaleInv = 1 / scale;
		const minmax = (a, b) => { return Math.min(Math.max(0, a), 1) * b * scaleInv; }
		const data = rect.data32F, cols = bgr.cols, rows = bgr.rows;
		for(let i = 0, n = data.length; i < n; i += 7){
			const confidence = data[i + 2];
			const left   = minmax(data[i + 3], cols);
			const top    = minmax(data[i + 4], rows);
			const right  = minmax(data[i + 5], cols);
			const bottom = minmax(data[i + 6], rows);

			//信頼スコアが低い、または領域の値がおかしいなら検出失敗と見做す
			if(confidence <= 0.5 || left >= right || top >= bottom){ continue; }

			const width = right - left;
			const height = bottom - top;
			//横幅と位置を若干補正
			rects.push_back(new cv.Rect(left - width * 0.1 , top, width * 1.2, height));
		}

		rect.delete();
		blob.delete();
		bgr.delete();

		return 0;
	}
	//カク付きを減らすため、前フレームとの平均を取る
	//※平均を取るとカク付きは減るが、動きが若干遅れるように見える
	const adjRect = (rect) => {
		if(oldRects === undefined){ oldRects = [rect, rect, rect]; }
		let tmp = [rect.x, rect.y, rect.width, rect.height];
		for(let i = 0; i < oldRects.length; i++){ 
			tmp[0] += oldRects[i].x;
			tmp[1] += oldRects[i].y;
			tmp[2] += oldRects[i].width;
			tmp[3] += oldRects[i].height;

			if(i > 0){ oldRects[i] = {...oldRects[i - 1]}; }
		}
		oldRects[0] = {...rect};

		const divInv = 1 / (oldRects.length + 1);
		for(let i = 0; i < tmp.length; i++){ tmp[i] *= divInv; }
		rect = new cv.Rect(tmp[0], tmp[1], tmp[2], tmp[3]);
	}
	//ランドマークの検出
	const getLandmark = (gray, rect, landmarks) => {
		let points = [];
		//※バインドが失敗するのでOpenCV側に自作関数を追加している
		//  処理の内容はfit()から引っ張っているだけなのでほぼ同じ
		let landmark = facemark.fitting(gray, rect);
		const data = isLBF ? landmark.data64F :  landmark.data32F;

		let index = 0;
		for(let j = 0; j < landmark.rows; j++){
			points.push({ "x" : data[index++], "y" : data[index++] });
		}
		if(points.length > 0){ landmarks.push(points); }
		landmark.delete();
	}
	//カク付きを減らすため、前フレームとの平均を取る
	//※平均を取るとカク付きは減るが、動きが若干遅れるように見える
	const adjLandmark = (landmarks) => {
		let landmark = landmarks[landmarks.length - 1];

		if(oldLandmarks === undefined){ oldLandmarks = [landmark]; }
		let tmp = [];
		for(let i = 0; i < landmark.length; i++){ tmp[i] = landmark[i]; }
		for(let i = 0; i < oldLandmarks.length; i++){ 
			let oldLandmark = oldLandmarks[i];

			for(let j = 0; j < landmark.length; j++){ 
				tmp[j].x += oldLandmark[j].x;
				tmp[j].y += oldLandmark[j].y;
			}
			if(i > 0){ oldLandmarks[i] = {...oldLandmarks[i - 1]}; }
		}
		oldLandmarks[0] = {...landmark};

		const divInv = 1 / (oldLandmarks.length + 1);
		for(let i = 0; i < tmp.length; i++){ 
			tmp[i].x *= divInv; 
			tmp[i].y *= divInv; 
		}
		landmark = {...tmp};
	}
	//顔向きの計算
	const getPose = (gray, landmarks, poses, angles) => {
		//3Dモデルと2D画像の対応から、カメラの姿勢と位置を計算
		const solvePnP = () => {
			const landmark = landmarks[landmarks.length - 1];

			//ランドマークのポイントは下記を参考
			//https://ibug.doc.ic.ac.uk/resources/facial-point-annotations/
			const _pnp2D = [
				landmark[30].x, landmark[30].y, //鼻
				landmark[8].x,  landmark[8].y,  //顎
				landmark[45].x, landmark[45].y, //左目左端
				landmark[36].x, landmark[36].y, //右目右端
				landmark[54].x, landmark[54].y, //口左端
				landmark[48].x, landmark[48].y, //口右端
			];
			//3Dモデルでの_pnp2Dと対応する各パーツの座標を決め打ち
			const _pnp3D = [0,0,0, 0,-330,-65, -225,170,-135, 225,170,-135, -150,-150,-125, 150,-150,-125];
			const pnp2D = cv.matFromArray(6, 1, cv.CV_32FC2, _pnp2D);
			const pnp3D = cv.matFromArray(6, 1, cv.CV_32FC3, _pnp3D);

			//カメラの姿勢と位置を計算
			cv.solvePnP(pnp3D, pnp2D, camera, distCoeffs, oldRotate, oldTranslate, true);
			//※Ransacの方がロバスト性が高いが、今回は相性が悪いようなので使わない
			//cv.solvePnPRansac(pnp3D, pnp2D, camera, distCoeffs, oldRotate, oldTranslate, true);

			pnp2D.delete();
			pnp3D.delete();
		}
		//カメラの姿勢と位置から、任意の3D座標を2D上に射影
		const projectPoints = (pose) => {
			const border = 300;
			const _proj3D = [ 
				-border, -border,   0, -border, -border, border, 
				-border,  border,   0, -border,  border, border, 
				 border,  border,   0,  border,  border, border, 
				 border, -border,   0,  border, -border, border, 
				      0,       0, 100,
			];
			const _proj2D = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
			const proj3D = cv.matFromArray(9, 1, cv.CV_32FC3, _proj3D);
			let proj2D = cv.matFromArray(9, 1, cv.CV_32FC2, _proj2D);

			//射影
			cv.projectPoints(proj3D, oldRotate, oldTranslate, camera, distCoeffs, proj2D);

			const data = proj2D.data32F;
			for(let i = 0; i < proj2D.rows; i++){ pose.push({"x": data[i * 2], "y": data[i * 2 + 1]}); }

			proj2D.delete();
			proj3D.delete();
		}

		const w = gray.cols, h = gray.rows;
		const focalLength = Math.max(w, h);
		const center = new cv.Point(w / 2, h / 2);
		const _camera = [focalLength, 0, center.x, 0, focalLength, center.y, 0, 0, 1];
		const camera = cv.matFromArray(3, 3, cv.CV_64FC1, _camera);

		const distCoeffs = cv.matFromArray(4, 1, cv.CV_64FC1, [0, 0, 0, 0]);
		if(oldRotate == undefined){ oldRotate = cv.matFromArray(3, 1, cv.CV_64FC1, [0, 0, 0]); }
		if(oldTranslate == undefined){ oldTranslate = cv.matFromArray(3, 1, cv.CV_64FC1, [0, 0, 0]); }

		solvePnP();

		//顔向きのボックスの座標を取得
		let pose = [];
		projectPoints(pose);
		poses.push(pose);

		//位置と首の傾きを取得
		const pitch = oldRotate.data64F[0];
		const yaw   = oldRotate.data64F[1]; 
		const roll  = oldRotate.data64F[2];
		const x     = oldTranslate.data64F[0];
		const y     = oldTranslate.data64F[1]; 
		const z     = oldTranslate.data64F[2];
		angles.push({ "yaw": yaw, "pitch": pitch, "roll": roll, "x": x, "y": y, "z": z });

		distCoeffs.delete();
		camera.delete();
	}
	switch(msg.data.type){
	case "detect": {
		//メインスレッド側から送られてきたバッファからMatを作成
		let img = new cv.Mat(msg.data.height, msg.data.width, cv.CV_8UC4);
		img.data.set(new Uint8Array(msg.data.buffer));

		//メインスレッド側に送り返す画像。デフォルトは送られてきたものそのまま
		//画像処理した結果をキャンバス上で確認したい場合はこれを上書きする
		let showImg = img.clone();

		let gray = img.clone();
		cvtGray(gray);

		let faces = [];
		let landmarks = [];
		let boxes = [];
		let angles = [];

		//顔領域の検出
		let rects = new cv.RectVector();
		let direction = isDNN ? getRectDNN(img, rects) : getRect(gray, rects);

		for(let i = 0; i < rects.size(); i++){ 
			let rect = rects.get(i);
			adjRect(rect);
			faces.push(rect); 

			//ランドマークの検出
			getLandmark(gray, rect, landmarks);
			adjLandmark(landmarks);

			//ボックスの座標の計算
			getPose(gray, landmarks, boxes, angles);
		}

		//メインスレッド側に画像を送り返す
		let channels = showImg.channels();
		let width = showImg.cols;
		let height = showImg.rows;
		let buffer = new Uint8Array(showImg.data);

		self.postMessage({ type: "detect", buffer, channels, width, height, faces, direction, landmarks, boxes, angles }, [buffer.buffer]);

		rects.delete();
		gray.delete();
		img.delete();

		break;
	}
	}

});

