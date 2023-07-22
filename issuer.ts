import { newJwtIssuer } from "./security/jwt.ts";

const issuer = await newJwtIssuer({
  public:
    "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ0ek92M3hzcGdaNFRWa0RINWZjbjI5b3JLX3Y1QVhodVh0NF9FNVJuREFzZ0xLSkxTZVFRdGwwbW1sVm1oLWlRTkhpQnYtemF1U2FEd0pGaXF1WFJOeFFrXzBiTTZEdWdEQnlaU2wwWmdxRjVkcTVfUXVsVjU4TTMxZHNQX0MxU3pyWmtzMHh4djFTMlU5b25pRmRHRTQxbTkyaWRWMDNKelNXX0xNYkVqMktlYk13UnN4d3lwYWNCdlU2Nkd2Z0l2WXl0bVk1c3l3ZlpXY1EyQk9sdFFsTWVsSzZ0UUFUOFJDR3hqcTNWVUQ1cEJUNElzdFJZTk1WWkJZYnBLc0k1WVJVRVpza3d3VWpGZGs3ZXhweElZbzl2NDIyUVdWd3Exb0NXMEtNakhfS1JXR3dzS3lJa0J3SF9PQWcxQTBNSGFFTkt4c3lHRXMta1haNGV5c0J5QWJJVDM1YWZBc29Jd0lZUTk4WUZTQktndGVsbU9iMUlkT2p4aVhkYzdWaEdBX25vNzVCYUFKUEo2RXdmbGM3N1gtOGs3aS01azJmcVNWemUtaU41SVdwY3g2ejZHdUpKNVhHWGlDeFpWbHBGclJmczdjRktTNm1jcjBUWDJSTUt0NXNEWXVscGw2ZnZaQlEwU1ZFN19NeUJVOWdibFlBVWdta3U2UzRsb2d4Nm44bmpTTm91c2l6amY4NlRaWGljejJiUDBWdHhfVEoxRW5kcEZXcFRuUjExNUJkVWZRVlNfNG9tdVFtam9nN3BaaGRGbmtQRVA4bEU2cUJ1YWpUYXBocDl6VjZFejlLOFh4SHptQWh4OGxGSFA5QjZWV3MzNkxzaUsyU0F5clU4Y0dkbGVobEROSk1UTDdIRnU1ZUd0ZkZzRXFRUVhteFo1YnRuckYwRmpVOCIsImUiOiJBUUFCIiwia2V5X29wcyI6WyJ2ZXJpZnkiXSwiZXh0Ijp0cnVlfQ==",
  private:
    "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ0ek92M3hzcGdaNFRWa0RINWZjbjI5b3JLX3Y1QVhodVh0NF9FNVJuREFzZ0xLSkxTZVFRdGwwbW1sVm1oLWlRTkhpQnYtemF1U2FEd0pGaXF1WFJOeFFrXzBiTTZEdWdEQnlaU2wwWmdxRjVkcTVfUXVsVjU4TTMxZHNQX0MxU3pyWmtzMHh4djFTMlU5b25pRmRHRTQxbTkyaWRWMDNKelNXX0xNYkVqMktlYk13UnN4d3lwYWNCdlU2Nkd2Z0l2WXl0bVk1c3l3ZlpXY1EyQk9sdFFsTWVsSzZ0UUFUOFJDR3hqcTNWVUQ1cEJUNElzdFJZTk1WWkJZYnBLc0k1WVJVRVpza3d3VWpGZGs3ZXhweElZbzl2NDIyUVdWd3Exb0NXMEtNakhfS1JXR3dzS3lJa0J3SF9PQWcxQTBNSGFFTkt4c3lHRXMta1haNGV5c0J5QWJJVDM1YWZBc29Jd0lZUTk4WUZTQktndGVsbU9iMUlkT2p4aVhkYzdWaEdBX25vNzVCYUFKUEo2RXdmbGM3N1gtOGs3aS01azJmcVNWemUtaU41SVdwY3g2ejZHdUpKNVhHWGlDeFpWbHBGclJmczdjRktTNm1jcjBUWDJSTUt0NXNEWXVscGw2ZnZaQlEwU1ZFN19NeUJVOWdibFlBVWdta3U2UzRsb2d4Nm44bmpTTm91c2l6amY4NlRaWGljejJiUDBWdHhfVEoxRW5kcEZXcFRuUjExNUJkVWZRVlNfNG9tdVFtam9nN3BaaGRGbmtQRVA4bEU2cUJ1YWpUYXBocDl6VjZFejlLOFh4SHptQWh4OGxGSFA5QjZWV3MzNkxzaUsyU0F5clU4Y0dkbGVobEROSk1UTDdIRnU1ZUd0ZkZzRXFRUVhteFo1YnRuckYwRmpVOCIsImUiOiJBUUFCIiwiZCI6ImNfZU84NDZSRnBDR3N3bXN3QUJVeGRGemxKTWF5M2g5ZlNYNERaX2FId0NIN0ZrTGlZbUpucmFXY2dsdkxzYmpTYU9pbG1nTENEcS1HYzZ1QTNvWWxtSDFEWGEyekthNXFCRU9ZOGxORmFpN1o0b0wyc0l6YzlMYWJGQVA3VlNQWDNTTGlBZnkxT2Q5eHRTSVE4RGpCZ3R6UzFkNGljUWU0dkpxOHFBYjJwdlZwdzhDZ1R0dlBfYlluZ25RdXJPWmJNczVOTU80VUVqMnAtRVJSTWl5TmRMQnYtSldudmpJNnlQYzduRlJYMHN5VlhRd00ydEJMcDVodktMcXdfdFFNUWtKMFRxMzF4SUdsTjVXSEtqZkZTeXc2ZWozXy1qYzRRMWk2a3pxTmhYcE5XeThCTTNHdW56a0hvYnJiOVlsUVRXZmh2bi1RTGdaMW56NkJ1UU5CYjBWQUhReXBzZjN5ZDl2R1dSeHV0U2ZFRmFiWWlldUJxeVlzcEZ0ZGp5R0gtUGY3OHlIMGFlSEdDTF9XS0ZCVVJ0bWhsSW5tTHU5ZFlsM21rUzdMc2hBNjlYNlIwSS1xOWpnbFN1d215aXpBRWNyT01EWjhmOG8yY1dhSHVUNFRpM1pFQl93UHB6bUdPbzdDekZaNG56VGc5V00xdUdsSUtZWHFUbjhjUlRwN2tGMUM4a0hKUUpwVzBoTXRheDdTYU0wRkI4V242bGsyMnFiX0VMb1gyRTltLWViMlNlNTh3bDQ5WHhKWG9HYUhPTDRWalNsa01CNGhWV3pyUEtNVERBbWZmaEFlbV9JWnFvT2w3YmNtMk9XamJabUVvR0ZhV0NXWmd0bzQ0TlI5U08wWnd1cVQyZllaS2lJN3dZMmVBVG5qeWZldFZ6NGxzRmxqSDNvQkdFIiwicCI6InktZUU5OXhMNW51WDRRa2xJZUZKM2pBcDZyaC11Y2U0dHZMS2RrSS1LQk9vSG54emFKNjJoUGwwYTMtY2sxRE9JTEdhQlpCTHBZeldyX05xY0daZXpwemw1UDhtZ0txNjA5Rktia0EyazZIc3E5TnZCbDd5QkVZRC00dU0zM25pSi1hdDl1WXVCNFdYQTlpbUJKNnBhSjJRV0VjZXdPcG9QMUFvQzhHTkprRWFFZGNZOU9xQW5yZzQ2NGZVZUhRb1BUQ09MTkU1a2J0RllyRHJqN25jX2tOTG40YzBBbm8xbkwzZE5iM1JPYXJBcW1TcWEzS2ozM05rMFVOTGFuZWYyQXlDNVR1OVNxSDI5Qi1NTXJyOWxWa21QXzh4VmF1WlNoLS1wQ1YtS0N1bFhxMllpZ3R5MG9MVWdGSko2N2pGelp1el80TktfS09EVGp3aDZvVHNFUSIsInEiOiI1Z0ljWDMxYWcwVDQ5ZV85NmhTMHVjZjlJX0pLYm1tbHlPN2l5RTZhSzVXMnlSRF9SWTdWT195aDJhRmFHejBPOWRkM1BHV1RzSzJUVUZmbjBXYUc3VWdIczdiZW0yNWtIUWpJSVMzNGFvQTUwOTNQZnBnc2FaZkJDVFVxZ2Zwc1dJbnAyMDFpQjRNcnQ2YkZyX0ozZXJ3QUhhRFBpd2JFQ29IM2U5SmVIV3JOV1RGWXh3RXp0alFndV92QUk1UjlJcnkxUG42MVgzaXYxeDV5Y1dPUDNpWnpTWFFwQjZwbzR5Vzg3MFhTN194UDV2Zjh4OU5MV0lYV2RpdnN0bGt1LU9fTE1ic2t1X1ZSR2pYbjVocEUzTEtzRkpuM0dEaDVHRldfSS15eXlIdDZvcXFydEo0UjdIUGVRMzJ6NmpVd0xlTXd5bEZlLUdFNHRIM1VuTkhEWHciLCJkcCI6IlFhYTRoRW1VMG9fbXRka0k4S0NsOVBrUzlmVVRNR1BpMEZ6WjNUdTA0Wmg2bjk0NEZtNUxuQUxwZmhjblpiTTF1d2NUN1VpcFlwTTNLSTI2THBoM1hCVGVYRjNlbXJ6ZHpJZHRiSlFXUG5CN1VGT1NRcjNkTkkwS2lUcEVVRXZoQ2pIV3YxRWJidWFQV2ZpdWMzeFdWVTJ1QlE1WkU0b2xxSVQ1YjllUXg4bGNTSFEySDkxRkxsVm9Wa1YwbnBmZndOdmFXd20tZkhLTWc1c3RMU2lOd193TTVEOVctcGs0bThfeDRuVE1ZY0hkcUw4aXM5ZkVkWlNrMkVfUGYyY211eHhFSk9TWUxPaDdKOXprZWcwRXlzcGFhMjZTQnVCcVNaaHdfRTdxRUtzRTRyZ0lEaUpqaE80RTE1QW5KdE5tTks0MlJVV1Rwa1pMWjZ3cXkyU2kwUSIsImRxIjoicUI2ODNITkUySlJ1b1YxMUxFZE1Qa3RXMVpLQkl5bG51M0laSTY2SWNfa3ZyTklXdEtJTmJKWmhPekQ4S3RLN2Y2aXBoLVQ3U2ZYbHFxRkdXY0htTjhRaGxSUENyTHZJdzR3cXRFM2t1UHZXeU96bGdMUDhLb1o0MjZFWDJfX09kX3otaVlTTGRkQkVBUzRPYTJnQU94NzF1ckpUWVZ4bHFRU01mOTRwV3JrNU5jdWpCM3J5Y0dpejBKUFlRbW1ELWdNVE80WGtUczlwUUFVS1E2VXhnSUI4WGlGZzZEQ0FFQ0FDZEthRjQxSjZtT21FeEE3R2tRTHEybC1LMjFKZXlpaUVUbXByRkZQZ254YnQxVHc0UDFULUFPVDFQcWZ3bzNfeGdYRy0wRm1wTHdNdkZJdEJzS0tVd0tJLUFxQTBBaWFCQUREd0NQOFBNcWFTNUxsU1l3IiwicWkiOiJtdnd4a1FtanNTSlZOYVNlMFlqOW9RR0I4U1hkdHVuMHpsbkNhYk1DZjVOcXowR2JYOEdjdUlsS0lnQlczVGFWNC1PSUlTcXRKQUVyYV9RT014NzJyenlaMGg2YjRZS19SQm9vcDZUZmh3RHoyQzM2LVR5ZEt2UGhsT3JLR2I1ek1TeEF6YlItazdqZnRRS0dDYjNmLWt4NmlVTW9DaGZUZFpLN2lwTVBMQ2JSTG1jS1NMcW1BcndISkY0QlExcG1Xb0xkMk5LWm1ybUlmWFJhMWcyN1dSQnpPVkNLYXo5VGQ2eW9oRHUyOHk3WUI2VW5PdDdLdTdJUWJqTUp1bjdUZnhwblBLUUR0ZkVRQmRETGFfaHdFcEJVdDA0NmZmTW1fcTF4YjhVTTdxSktVREx1clpzalV2ZkZzemhMVnktYl9MdG1xNmk4SnprZUttVzEzNm81SEEiLCJrZXlfb3BzIjpbInNpZ24iXSwiZXh0Ijp0cnVlfQ==",
});

console.log(
  await issuer.issue({
		"iss": "urn:site:admin",
    "sub": "urn:site:x",
    "scopes": ["http://localhost:8000/*"],
  }),
);
