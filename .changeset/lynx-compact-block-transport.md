---
'@octanejs/lynx': patch
---

Preserve compiler-proven program addresses through the Lynx Block core and add a transactional
adapter from addressed scalar Block batches to the compact compiled-program transport, including
acknowledgement-gated listener publication, retry, abort, native-event race, and disposal handling.
