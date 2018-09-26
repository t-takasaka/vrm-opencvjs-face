//true�Ȃ�DNN�Afalse�Ȃ�J�X�P�[�h�^���ފ����̈�̌��o�Ɏg�p
//��DNN�͐��m�����d���B�J�X�P�[�h�^���ފ�͑���������̐��x���Ⴍ�A���ʊ�������J����Ɛ��x��������
const isDNN = true;
//true�Ȃ�Haar-Like�����i���Í��j�Afalse�Ȃ�LBP�����i�P�x���z�j���J�X�P�[�h�^���ފ�Ŏg�p
//����̈�̌��o��DNN���g���ꍇ�͂��̃t���O�͖��������
const isHaar = true;
//true�Ȃ�LBF�Afalse�Ȃ�Kazemi�������h�}�[�N�̌��o�Ɏg�p
//��Kazemi��Dlib�Ɠ����A���S���Y���̂͂��������x���オ��Ȃ��B�p�����[�^����̌��؂��K�v
const isLBF = true;

let classifierFront;
let classifierProf;
let net;
let facemark;

let Module = {
	locateFile: (name) => {
		//wasm�̎w��
		let files = { "opencv_js.wasm": "opencv_js.wasm" }
		self.postMessage({ type: "locateFile" });

		return files[name]
	},
	preRun: () => {
		const dir = "assets/";

		//�����h�}�[�N�̓�����
		const landmark = isLBF ? "lbfmodel.yaml" : "face_landmark_model.dat";
		Module.FS_createPreloadedFile("/", "landmark", dir + landmark, true, false);

		if(isDNN){
			//DNN�̃��f���ƃE�F�C�g
			Module.FS_createPreloadedFile("/", "proto", dir + "face_detector.prototxt", true, false);
			Module.FS_createPreloadedFile("/", "model", dir + "face_detector.caffemodel", true, false);
		}else{
			//�J�X�P�[�h�^���ފ�̓�����
			const cascadeFront = isHaar ? "haarcascade_frontalface_default.xml" : "lbpcascade_frontalface_improved.xml";
			Module.FS_createPreloadedFile("/", "cascadeFront", dir + cascadeFront, true, false);
			const cascadeProf = isHaar ? "haarcascade_profileface.xml" : "lbpcascade_profileface.xml";
			Module.FS_createPreloadedFile("/", "cascadeProf", dir + cascadeProf, true, false);
		}

		self.postMessage({ type: "preRun" });
	},
	postRun: () => {
		//�����h�}�[�N�̓ǂݍ���
		facemark = isLBF ? cv.createFacemarkLBF() : cv.createFacemarkKazemi();
		facemark.loadModel("landmark");

		if(isDNN){
			//DNN�̓ǂݍ���
			net = cv.readNetFromCaffe1("proto", "model");
		}else{
			//�J�X�P�[�h�^���ފ�̓ǂݍ���
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

//�O�t���[���Ƃ̕��ς�����ăJ�N�t�������炷���߂̕ϐ�
let oldRects = undefined;
let oldLandmarks = undefined;
let oldRotate = undefined;
let oldTranslate = undefined;

self.importScripts("opencv.js");
self.addEventListener("message", async (msg) =>{

	//�O���[�X�P�[��
	const cvtGray = (gray) => {
		cv.cvtColor(gray, gray, cv.COLOR_RGBA2GRAY);
		//�K�p�I�q�X�g�O�������R��
		let clahe = new cv.CLAHE();
		clahe.setClipLimit(1);
		clahe.apply(gray, gray);
		clahe.delete();
	}
	//��̈�̌��o
	const getRect = (gray, rects) => {
		const scaleFactor = 1.1; //1.1
		const minNeighbors = 3; //3
		const minScale = 0.3;
		const minSize = new cv.Size(gray.cols * minScale, gray.rows * minScale);
		let maxArea = 0;

		//���ʊ�
		const getRectFront = () => {
			classifierFront.detectMultiScale(gray, rects, scaleFactor, minNeighbors, 0, minSize);
			for(let i = 0; i < rects.size(); i++){
				let rect = rects.get(i);
				let area = rect.width * rect.height;
				if(area > maxArea){ maxArea = area; }
			}

			return rects.size();
		}
		//����
		const getRectProf = (flip) => {
			//�J�X�P�[�h�f�[�^���E�����ɂ����Ή����ĂȂ��̂Ŕ��]
			if(flip){ cv.flip(gray, gray, 1); }

			let _rects = new cv.RectVector();
			classifierProf.detectMultiScale(gray, _rects, scaleFactor, minNeighbors, 0, minSize);

			//�傫���̈悪���Ă��������ւ�
			//�����󂾂ƑO�i�Ō��o�ł��Ă��Ȃ��̂��m�肵�Ă���irects����j�̂ł��̏������Ə璷
			for(let i = 0; i < _rects.size(); i++){
				let rect = _rects.get(i);
				let area = rect.width * rect.height;
				if(area <= maxArea){ continue; }

				maxArea = area; 
				rects.resize(0, new cv.Rect());
				for(let j = 0; j < _rects.size(); j++){
					let tmp = _rects.get(j);

					//����͎኱�傫�߂Ɍ��o�����̂Œ���
					//�f�[�^����蒼���������悳����
					const scale = 0.775;
					tmp.width *= scale;
					tmp.height *= scale;
					tmp.y += tmp.height * 0.175;

					//x���W�𔽓]
					if(flip){ tmp.x = gray.cols - tmp.x - tmp.width; }
					rects.push_back(tmp);
				}
				break;
			}
			_rects.delete();

			return rects.size();
		}

		//����
		let size = getRectFront();
		if(size > 0){ return 0; }
		//�E����
		size = getRectProf(false);
		if(size > 0){ return 1; }
		//������
		size = getRectProf(true);
		if(size > 0){ return 2; }

		return -1;
	}
	const getRectDNN = (img, rects) => {
		//DNN�͓��쑬�x�I��128px���炢�����E
		const scale = 128 / Math.max(img.cols, img.rows);
		let bgr = img.clone();
		cv.resize(bgr, bgr, { width: bgr.cols * scale, height: bgr.rows * scale} );
		cv.cvtColor(bgr, bgr, cv.COLOR_RGBA2BGR);
		let size = { width: bgr.cols, height: bgr.rows };

		//���ϒl�B�o���͉��L
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

			//�M���X�R�A���Ⴂ�A�܂��͗̈�̒l�����������Ȃ猟�o���s�ƌ���
			if(confidence <= 0.5 || left >= right || top >= bottom){ continue; }

			const width = right - left;
			const height = bottom - top;
			//�����ƈʒu���኱�␳
			rects.push_back(new cv.Rect(left - width * 0.1 , top, width * 1.2, height));
		}

		rect.delete();
		blob.delete();
		bgr.delete();

		return 0;
	}
	//�J�N�t�������炷���߁A�O�t���[���Ƃ̕��ς����
	//�����ς����ƃJ�N�t���͌��邪�A�������኱�x���悤�Ɍ�����
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
	//�����h�}�[�N�̌��o
	const getLandmark = (gray, rect, landmarks) => {
		let points = [];
		//���o�C���h�����s����̂�OpenCV���Ɏ���֐���ǉ����Ă���
		//  �����̓��e��fit()������������Ă��邾���Ȃ̂łقړ���
		let landmark = facemark.fitting(gray, rect);
		const data = isLBF ? landmark.data64F :  landmark.data32F;

		let index = 0;
		for(let j = 0; j < landmark.rows; j++){
			points.push({ "x" : data[index++], "y" : data[index++] });
		}
		if(points.length > 0){ landmarks.push(points); }
		landmark.delete();
	}
	//�J�N�t�������炷���߁A�O�t���[���Ƃ̕��ς����
	//�����ς����ƃJ�N�t���͌��邪�A�������኱�x���悤�Ɍ�����
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
	//������̌v�Z
	const getPose = (gray, landmarks, poses, angles) => {
		//3D���f����2D�摜�̑Ή�����A�J�����̎p���ƈʒu���v�Z
		const solvePnP = () => {
			const landmark = landmarks[landmarks.length - 1];

			//�����h�}�[�N�̃|�C���g�͉��L���Q�l
			//https://ibug.doc.ic.ac.uk/resources/facial-point-annotations/
			const _pnp2D = [
				landmark[30].x, landmark[30].y, //�@
				landmark[8].x,  landmark[8].y,  //�{
				landmark[45].x, landmark[45].y, //���ڍ��[
				landmark[36].x, landmark[36].y, //�E�ډE�[
				landmark[54].x, landmark[54].y, //�����[
				landmark[48].x, landmark[48].y, //���E�[
			];
			//3D���f���ł�_pnp2D�ƑΉ�����e�p�[�c�̍��W�����ߑł�
			const _pnp3D = [0,0,0, 0,-330,-65, -225,170,-135, 225,170,-135, -150,-150,-125, 150,-150,-125];
			const pnp2D = cv.matFromArray(6, 1, cv.CV_32FC2, _pnp2D);
			const pnp3D = cv.matFromArray(6, 1, cv.CV_32FC3, _pnp3D);

			//�J�����̎p���ƈʒu���v�Z
			cv.solvePnP(pnp3D, pnp2D, camera, distCoeffs, oldRotate, oldTranslate, true);
			//��Ransac�̕������o�X�g�����������A����͑����������悤�Ȃ̂Ŏg��Ȃ�
			//cv.solvePnPRansac(pnp3D, pnp2D, camera, distCoeffs, oldRotate, oldTranslate, true);

			pnp2D.delete();
			pnp3D.delete();
		}
		//�J�����̎p���ƈʒu����A�C�ӂ�3D���W��2D��Ɏˉe
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

			//�ˉe
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

		//������̃{�b�N�X�̍��W���擾
		let pose = [];
		projectPoints(pose);
		poses.push(pose);

		//�ʒu�Ǝ�̌X�����擾
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
		//���C���X���b�h�����瑗���Ă����o�b�t�@����Mat���쐬
		let img = new cv.Mat(msg.data.height, msg.data.width, cv.CV_8UC4);
		img.data.set(new Uint8Array(msg.data.buffer));

		//���C���X���b�h���ɑ���Ԃ��摜�B�f�t�H���g�͑����Ă������̂��̂܂�
		//�摜�����������ʂ��L�����o�X��Ŋm�F�������ꍇ�͂�����㏑������
		let showImg = img.clone();

		let gray = img.clone();
		cvtGray(gray);

		let faces = [];
		let landmarks = [];
		let boxes = [];
		let angles = [];

		//��̈�̌��o
		let rects = new cv.RectVector();
		let direction = isDNN ? getRectDNN(img, rects) : getRect(gray, rects);

		for(let i = 0; i < rects.size(); i++){ 
			let rect = rects.get(i);
			adjRect(rect);
			faces.push(rect); 

			//�����h�}�[�N�̌��o
			getLandmark(gray, rect, landmarks);
			adjLandmark(landmarks);

			//�{�b�N�X�̍��W�̌v�Z
			getPose(gray, landmarks, boxes, angles);
		}

		//���C���X���b�h���ɉ摜�𑗂�Ԃ�
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

