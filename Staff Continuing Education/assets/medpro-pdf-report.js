/**
 * Shared CE report PDF export, used by both staff-app and admin-app.
 * Layout mirrors the existing MedPro Timesheet app's exported PDF: navy
 * header bar with the MedPro logo, green accent rule underneath, light
 * blue-grey table header row.
 *
 * Requires jsPDF + jsPDF-AutoTable to already be loaded on the page (see the
 * <script> tags in each index.html) before this file runs.
 *
 * opts:
 *   subtitle          e.g. "Continuing Education Report"
 *   personName        staff name, or "All Staff" for an admin all-staff report
 *   personSub         position / subtitle line under the name, optional
 *   from, to          "yyyy-MM-dd"
 *   records           array of { DateAttended, EventDescription, Location, Role, HoursClaimed, Status, StaffName }
 *   totalHours        number
 *   showStaffColumn   true to add a "Staff" column (admin all-staff reports)
 *   filename          download filename
 */

// MedPro Respiratory Care logo, 210x59 PNG (same file as assets/MedPro-logo.png).
var MEDPRO_LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAANIAAAA7CAYAAAAO0tQIAAAACXBIWXMAAAfUAAAH1AFGdmCNAAAUPElEQVR4nO1dbYhrx3l+jq722k6Ld00S1+1NujKU4vwId29JIKWOdi60AjWlK5EfDg3pni2FUgz13jb9o5rec2lQS6GNXPoFNexZKPSDgnbbgLCaco9kQlqI8S60kH6Aj2w3bkqopcbFXkl7Tn+cd6TR6HzNnLN310EPCJ2PmfedMzPvx7wzZ47h+z5WWGGFbChedgFWWCEv1LvVLQAbAEr04zhqVzonF8l7JUgrvG9BglMDwABsATgB4AAY0j+He9FlMVau3QrvJ9S71RIAk34bAGwA9kVbnCSsLNIK7wuQAFkAdgEMAFjtSsfm941yo4bAKjEEbt1mCJkeAuvkAHD8ftPNq3wri7TClUe9W7UA7NOp1a50WgBglBslBMJVA7CuQboHwPb7TTtrGZUEySg3HADbGfj1/H6ThdC1ANzNQBcAbvn95qWa9zxglBsbAN5WzHbb7zcdgYYJ4CBjUXrCsYNAkx/5/eYwI93UoDGQDeAmlcdsVzouCVALwE5OrAYA9v1+80iXQGrXjho4ixDFwcyYf/S9IEQEpppBFCJdGiHYDjk+MMqNYwDWRdd3vVs1EQjLOoDDdqVjAkpKl7txLubBiCirtQmgbZQbPQA1HWWhMkZiqsTTgLRnmD+rAm1NcgVRU0zfC7mmSkMFOwB2jHKjnkWDx4GEiFvUvXalY5MiP0K8Mh8hcPXsMGGgcdR+DI1tAK5RbtRClFMsCgppmQrhCLgh16wc6Do50LgqYIrpFzqzUW7Ead480boIovVu1cZciO4IQuQgXogOAZT8frMVZVH8fvOIhhZ3EAhdGNYB3CcFnxoqgpSHlnPFE6PcYMhujYDvEYtEQqBaH450znIpTDI2qby5gSzRLp0etiudliBEN2Oy3vP7TTOtS+b3my0E9RQlTEDgxppp6AEpXTsa3OXR4WVYOdA41R0A03OV5OuqZj0lLz7rznESUm6mSHYQMla5SLdOxkZyknSod6u1d77z6ME3/+WHMHrtkdF338SW8aXG5wH8OuKF6NDvNy1Vfn6/eUKK3EG0BT8wyo2TNOPBtGOk3BuHOlYewQsnJb8SFmfBIxWDUW7wwx7RP1IdXAv8TER0BKPcGCCwpi2a02AqPCA9u2ZAaIB5sKcG4DmFvDNFYJQbNkKUUgxafIz1cP03vnj9+q3f/u5bs3vrCJ7tk4gXop7fb5oKPBdAwmQB+HJMsiOj3NhKUtZpBYmlTJcERzjej0qkiFi3jszzPuIbJArb9LtLEZ39JIGizmwhXYfcpHTPGeXGHaiHcx3pnCnmBwIlwek4pKVT1RWvC1Iau/Gpl2ASrxaAm2eL90YAvgrg72Lyj5A92gu/32xRECJKAW1SGWN5pR0jsdQlSwHNig9FlBtmlBvMKDdcBANXHSGSsQ3g1Ti/WfDnVbQ6R5xWjIKsRJgGDUc6T1tXYrRQlW8PgXK7H8FvH8AfJtDgVjwPmAn3d0noI5EoSEQg7yhQXtboOOwidfb7uJhx3UFMpR4hH6FNg7CxoY4L7vCDpM4SlQ/qgrSFaGUzoP+4thshx6ghCeRhQjIr7mYai8TSFScVXNLaZk70HPlCTrP6SVhqROqEFzVhHQZH4l+CuuLoScLINPmrCnCcYm4hOQh1ESss7IT723FRyjSClFuggSR/H/lZOEc8oQdVEaJTAHUATyJ8YjMKYVbHVMgPBJq3DuAxAC8o5gXycetkGmnbesRd6guYt3oFyQoh9+kOep5BQrJITypWkMh65O2q5OXWhYV+Vc29RZN0LoQIVBqQBRChqnA47yGC92hUMAoZG2Z160pI39Yib6bBNwrHAD6bkGZ0USsqkCygkXWcZJFyDXuT2xWnveImyGQ4Em0GNddKbhDVyUUx9Kuz+ljkzRTzOiHXVGnI6xNVlJBY9jz7iIPk53By5KdKez3KvUsKfzOFQhwjPnzbQ7zv24OaIMjaw1TIu5BfZ3yRYWwBLAcKVDujI55ouldDo9zYRzCpyqBf93mOC/8DyVbxIhfLpqHNwtIlWSSWYyG2Ed9ZHQVeYemzdEammFf2pVXzi0KsIwS6YxsRmwhC7nehJgyHXAmQJc6Ehz4EPPRhDAHcA/BOiiwXJkgpw+mlsIuRFklj3VeaQkRhALXlJgsaXTNEvy/MCZUU8zoC7xLUx5GOcMwU8w5CGvxBLguyhGOmQ+D6Y/jPj3zinRtPffwNXP/AewBw3K50rJSCmXe0TsYp4ttT2bVjCswHyCZIFtSCEHlErLIEUZwMvOVAQVa37iICQlHYk4RYR4D3fvrZV00AN4RrnGaui2A1oSWoca4dU6Dj6DAn8PVmKp1B5vcgNbLMP5MgQH2MkYcSUcUIgRDZ/ILmvNU9opFlXHWRYyRtxAmSyrqvI+g3aAtqnXFBoz9gjQwEbqUrnDPF/OL4KFPImnCRSmSAYOxSCtnXgGnQk2no4CpYrSWEunaKS0WAoHF1HnCEoHJVQq+OdM40+GbBjL9moMARjpli3rBlQao0gOjJZ5d+Jwhe83BjaKgK8LHfb7q0G5AMPj6O4/egoPVqSNQYSaWSen6/ORRePVBBi/IyhTxZI1bHfr+ZlxZXpSMHClTzLzy7pnuV1/MzxfQO/ZdC7nEl7OoVJVckeTdu2MUoQWIKjB36Lynk4WhpRAcd6Zwp8lzIT5G7UtrM0ktkqrwzzV0hn7C3o5FnATmF7EWU6D/tPI6jyDsVaJiwgNLjG7h544O48eENGDDw7298572wvEuCpBHO5RVUUsgD0HyEojVa0Og5vZqtsjZv5hJpvkQn8maKecN2SlKlIZdBF1ktsYzNere64fc7Q3rZMa5NL3KMxPjB9z9UhPXzP47P7TyFYmENxcIa1q5dR7Gw9ktTb/JwsbBmihnDgg0s5FoUsmyDZWnwyxqxWlifpzEWzLKsB8g32geovwgYtj5RB1lc0ij+jP6dBFoPRJA+/bEfxM5nPoqxN8aEfuPzM0y8Mc7Oz3bH52emmDGrIIkVpDJIOxQ0lEpncKRzppA3LH+WzqyaN8srC8Dy+Eg1P5CPW6cTJZ3xbVc6UfM0vD6TFo7mvumKAMYPHv/gI/jv//k/PPub9/HRn3kRz9w5xpv/NXxncn6Gyfl7mHhjJmYMEySVDuIIxyqVawPa0UERqhUq51fhL2tzlbxA9mVBjnR+KeMj6G1gKQtH2OsKtcC9ax5F3BdhqpYhCdQmsz78fR8o4m9fctE5eR0A0P/Xb+HVf37rcHI+xuR8jPH52ULfK4QQU2lgR6PMPWEeSDk6KF3THqxrjAVtKW+WsZmpmDdsjMEUaQD5vMejbIlDroW5d+sCbTuBphkWGMiIhZU1//b62zj++uvipUH500/8zfh8jPH5GJPzM0e8KVskpsBYnphMC0uTX9ZOMJAE0YpKGAL51WamylyyZlnD3jrulfa2ZRKYYvqwdosaJ1n030L8KzXryNEqhe0h8tXTt/DN1xe2YN+feuPa1Jtg6o0xOR/b4k1ZkLTcOgWfdSC8WanaGZyQayrvL20Y5YZllBsmfQxAZfMVefPBkkJeAMGe1QLvrJFGHbcuszXKwRInlWWz3q3yuk5ae2nlaJWshPs9v988mp6PaxR4OLzx6JMLymAmSBrhXJ1AgyUcqy4LCtNiKp1jHcErAwdQe869EB9fZ7CrwxtA6BiDafB3NPLIUBXg0Hajj4JFKcEWjZVsRGxuQ1hHDkuOaJwep1RHAMxvfKvXGnvjzak3OZ14kyUhFy0SUymAxm6kA2m9lgq/KIGxoGaVVDACUI/4dk4eLlJahI0xmCKNsFfTdaDKN07RRd0TBcREfOBhR3WPbhFkYZOUsfnynz/NJudnz03PJ72Jd8Y+9qFbS+2vK0iypkhjkeT1dCr8nLCLwu6keQvTMYCtmL0BbE26OuWUx0d5TELrguXIN2595U69W90nF6+GHPfo5hC+bhEXXNt76eDHNibnk4OpNzn85A3Gbj3xdKgSFQVJN+wNJLs6fHEqAK3OIPObgVyHEoJVylkF6hDBR7tqcYEU0u57CvxGVD6mUSZHOs+DhjI0X56M1Pbk3sXt3PRlGi+dIN2G91baQtGzuEjYmP/oxacw9ScHY298OvbGdn/wFfa1N15i//TmP7BX3nqZnX77HxlPLC4RstMWBMsV5CSkD9sw/l5KXsOk6CDRthAMQBnm+3vHjft4Izqgr2GrRLX8ftM2yo0jBO5HDcsfsuoJdI+AmSuR9rk5H3mMMVSlgfy2r1LhO0xRnxaCjTyjcFDvVuH3Oza1q43ozn+Xf/8oZvfdEubfoY3D3l/+6Q9vTb3JAeDDN/ybPvz7AOD7PlAIvnJpwB+AAk+rb8iucKmod6sOkgMw4sfGbCSvhhlg/rlOjhqSo8QDADX7jx7fuGYU7xcLRawVirhmrCE4XsM1o4hiocjX393+1Ed+0gFWgrTCJYO+E/tqiqQvtCudfWDmmtnIb0vqEYJXeiwA+LPT3y0VjaJZLKyhKAqOUcRaYe2Ja4Xiw0WjeHL7yZ3ZOM/wfZ8/jDj4c/lP/AT7VQJ96fougHvtSse63NJcfdS7VYbADd1C4B4OAbTalY5zeaUKILRlEk4B7PMyU5DBhP6r6wPQi6V+vzn8/W88z4pG0S4Wrm/OBIj+uWVaC4TqtPojn1uIC3BBYoj2VY/blY7OBOCFot6tDhGMSUbtSifv5SJh/EqYz6bb7UrHvWieeaHerbYQvml9r13psAdcnFCkdPE4DgFYvA2kb18xxAdF+Nh19jmbe1//FbZmFK1iobgdWJ7AhVsrrAnCxC1ScXStsMZ+9ke/sDB2DXuxT/4awE69W2VXQXNJsBDMflsPiF8Jc63p4Gq8zZmIerdaw7IQjfBgvjOrghqCDp7GXdsFsFvvVnsA7NrzOGpXOi0IXlXSFxKf6/3cxq/1d821wtp+0SjeRMGH7/nwfR9+AfALPuD58INgQ/AfpDGfeeoXliaZwwTJblc6Fn0Ul0c3GKTInOAqlIR8dthTU2PWKK0L4Khd6RxJaSw6dBC4HzU6bkUsvR8iItJI3yLlvBzQchPuYwvpNugeQxDZ4qFWiO6i8KwcZr1bdWWrRC6ySeUPfU6BHqPTFuaRP7Nd6bhUX9x1cNqVjiPlcRQUmy0cHyNwjVyiF7oMh+rPRFAfNoTFpOIzS1b6CHOLYFF4W6S5L9BxEbTrLE270hnScztIL+T8Q3AHJFQOlXlYex4nvN9QO2898/efeeIho/jU9cI1dt0obvtceEhQPIMLC+D5XnAM0H0AwN7nP/5saAQ09FVzYlwSLsmd3sTym6XbZLnMhLTbmHdcEVzb72NekdsA7ta71XpIhzTpfg/LAsXv8Y0n1yHNWUSUS9TUlnCPYTFkuks83QR6u/Vu9VCuE6J3VzjeBgChkw6F+1sIOoiFuetjIwWoHcVOuc95kCA6UvoSgo4o1r8pnDtYtMQloZwm5tbElOieYDFixuvmliRMJyTgDtQtJhcqke9CgrHvjYDpuu8BngE8BB++AQTWyAvC2p5Ps6s+DM8H4NN9f+8Xb37RjmIe9j7SXQBvC4UayNoFcxPaw+JnSXZJK4sw6X+EYBJzD/Gz2usIfGBx9URc+jhsEr1TLAuuJRwfE8+oxnOw+CGqQywK0YZUxmPMJxB3qXNEgQv8TNCpk/PzHcrP26OnMD4T22KQIp+oxE4RtGvaubVN0HOIHgRZIi5E/BM6vG6W2pX6GiP+eWN97Hs486eY+FOcecH/xJtg4k0wnv2Pgzdj/dn53i/fathxhJP2/j5sVzol8QI1qqix3saiDy4HJhz+EAg0NkP8BOFxu9IxKcCR5uttSai3K50t8qFFcJqn7UqnRlYjdJEkdWxbuCQHG8TJ2Beo7KZwn8WU77hd6ZRCBv1ieY8iridBVICbEVthiRAFr0ausJWSVy/iOcT+0AbwGhb7zxIEYYpbtKqLb098D+96U7xHwnTmTTGeC40oWIOJN7n1q5/4kp1ENEyQxMLXSNtGgWtS8eeKCWissYe5htlF/EqIYcSxFsLGKBcMV/pPgh12kcrNFQnveAOV5yHLIGp2mwtTvVtl9W41z7qxU6SR+0rkEqF2pTMkhXQH+a6lfBQAzuHjzDvHmT/FmT/F1Jti4k8w9SfBHg3+5HjqTbYan/q9pcBCGMIE6QRzNyZsqfqJdFxD4BLweYmF9OQflygNr7jNEBeQo1bvVlsU7OAuQdKrxzrgjXOz3q3axE91MxEOsU4sCjeLndSJyRunLKyE8zQQLdg2gNdo6uA+lhcbu8KxTQGgtDzdiOuOSJMs1gldN5OIkiexheRvvKbFIwDeBQAP/swivetNMfamGHuTwdgf3/6dp1+s/dZP/ElqRR7l2u1j3tF2aCANYKbl+JqrHQSu3at0bIkWjLTfTQTjrvtY9PPjJP05LA7udcdIcRBp7tJPS/NRnezR6TqC8nPX8VB36kBSSiNorJkjGnvS5aixoCx0d6G586hEkyvCg3q36iOon7tIuQC3Xem45HrfRj4C9b/8wANw5p/jzD8/fc+b7v3x7b8u/cH2XziqBHnUzsVcOBwKRZqY+8wLlUnh8RMshk9PEIQ9h0I6t96t7iGwWpzGEeI7RAuBBStRuax2+CDZRvR8Dr8XCXoGB/MQvoP4L8a5mNfREs92pWPXu1UXQZ3wZ42aEhDLtkSLQ1RgREvL1Y0omwvJ26Co2WOYTwm4WNybXS6ri5g6IZpD8j4szPvTEMHzKCkGHmkkS8nHoTr7vv8A/XPlZP/VT33F0aAzw5VZa0eaClgt+ZmBOj+3bE++n1ZTPCiQ18MQCOkWAqUYFpwaIVD2Lv2/0q50Xs6rHEmfvlzhkkDWSHQP3csrzdUF1Yt9ycW4UoLEAxHuZRbiCmEL8zqxL7EcK6TAlXHtVljh/YykCdkVVlghBf4fo4mCN8wHXQwAAAAASUVORK5CYII=';

function exportCEReportPDF(opts) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: 'pt', format: 'letter' });
  var pageWidth = doc.internal.pageSize.getWidth();

  // Navy header bar + green accent rule (matches the Timesheet app's export).
  doc.setFillColor(0, 61, 121);
  doc.rect(0, 0, pageWidth, 72, 'F');
  doc.setFillColor(80, 185, 72);
  doc.rect(0, 72, pageWidth, 4, 'F');
  doc.addImage(MEDPRO_LOGO_B64, 'PNG', 40, 18, 106, 30);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text('MedPro Respiratory Care', pageWidth - 40, 32, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(opts.subtitle || 'Continuing Education Report', pageWidth - 40, 48, { align: 'right' });

  var labelColor = [90, 107, 123];
  var valueColor = [29, 43, 58];
  var y = 100;

  function labelValue(x, label, value) {
    doc.setTextColor(labelColor[0], labelColor[1], labelColor[2]);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(label, x, y);
    doc.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(value, x, y + 15);
  }

  labelValue(40, 'STAFF', opts.personName || 'All Staff');
  labelValue(320, 'PERIOD', opts.from + '  to  ' + opts.to);
  if (opts.personSub) labelValue(40, 'POSITION', opts.personSub, true);

  y += 40;
  doc.setDrawColor(225, 231, 238);
  doc.line(40, y, pageWidth - 40, y);
  y += 20;

  var head = opts.showStaffColumn
    ? [['Date', 'Staff', 'Event', 'Location', 'Role', 'Hours', 'Status']]
    : [['Date', 'Event', 'Location', 'Role', 'Hours', 'Status']];

  var body = opts.records.map(function (r) {
    var row = [r.DateAttended || '', ];
    if (opts.showStaffColumn) row.push(r.StaffName || '');
    row = row.concat([
      r.EventDescription || '',
      r.Location || '',
      r.Role || '',
      String(r.HoursClaimed || 0),
      r.Status || ''
    ]);
    return row;
  });

  doc.autoTable({
    head: head,
    body: body,
    startY: y,
    margin: { left: 40, right: 40 },
    styles: { fontSize: 9, cellPadding: 6, textColor: valueColor },
    headStyles: { fillColor: [238, 242, 247], textColor: [0, 61, 121], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 251, 253] }
  });

  var finalY = doc.lastAutoTable.finalY + 24;
  doc.setTextColor(0, 61, 121);
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Total Hours: ' + opts.totalHours.toFixed(2), 40, finalY);

  finalY += 40;
  doc.setDrawColor(200, 200, 200);
  doc.line(40, finalY, 220, finalY);
  doc.setTextColor(labelColor[0], labelColor[1], labelColor[2]);
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.text('Generated ' + todayISO_local_(), 40, finalY + 12);

  doc.save(opts.filename || 'CE-Report.pdf');
}

function todayISO_local_() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
