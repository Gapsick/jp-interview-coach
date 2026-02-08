/**
 * Vue 앱 진입점 (엔트리 파일)
 *
 * Vue 인스턴스를 생성하고 index.html의 #app 요소에 마운트(연결)
 * → 이 시점부터 Vue가 화면을 관리하기 시작함
 */
import { createApp } from 'vue';  // Vue 프레임워크에서 앱 생성 함수 가져오기
import App from './App.vue';       // 최상위 컴포넌트 (App.vue)

// Vue 앱 생성 → index.html의 <div id="app"></div>에 연결
createApp(App).mount('#app');
